import { isRpcCancelled } from './cancel';

/**
 * Package 4a: one typed classification of RPC failures, shared by the transport,
 * the outcome resolvers and the outcome sweep. The kinds that say nothing about
 * the row being measured — the provider refused or could not be reached — must
 * never become an outcome or a terminal UNRESOLVABLE write.
 */
export type RpcErrorKind = 'quota' | 'rate_limit' | 'transport' | 'archive' | 'revert' | 'unknown';

/** Chainstack's plan exhaustion (2026-09-18, CHANGELOG): "You've reached your
 *  monthly quota of Request Units". Checked first: it can arrive as an HTTP 429. */
export const QUOTA_PATTERN =
  /monthly quota|quota of request units|reached your (?:\w+ )?quota|quota (?:has been )?(?:exceeded|exhausted|reached)/i;

/** ordofi `-32005 "network is busy"`, blockmachine `rate limit exceeded`, generic 429s;
 *  `request limit` and `-32097` are the outcome sweep's former retry texts (review 896555be) */
export const RATE_LIMIT_PATTERN =
  /rate.?limit|too many requests|429|network is busy|try again in a moment|exceeds defined limit|request limit|-32005|-32097|capacity|throttl/i;

/** the node answered but no longer holds the historical state asked for */
export const ARCHIVE_PATTERN =
  /missing trie node|header not found|missing.*(state|archive)|no historical|not available|state.*not.*available|pruned|block .* not found|could not be found|getDeleteStateObject|required historical state/i;

/** viem's TimeoutError / HttpRequestError and Node socket failures; bare `network`
 *  is the outcome sweep's former retry text (review 896555be) */
export const TRANSPORT_PATTERN =
  /timeout|timed out|took too long to respond|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|HttpRequestError|WebSocketRequestError|HTTP request failed|network/i;

export const REVERT_PATTERN = /revert|execution reverted|VM Exception|invalid opcode|out of gas|0x[0-9a-f]*$/i;

/** precedence order: the first match is the error's kind */
const KIND_PATTERNS: ReadonlyArray<readonly [RpcErrorKind, RegExp]> = [
  ['quota', QUOTA_PATTERN],
  ['rate_limit', RATE_LIMIT_PATTERN],
  ['archive', ARCHIVE_PATTERN],
  ['transport', TRANSPORT_PATTERN],
  ['revert', REVERT_PATTERN],
];

/** any http(s)/ws(s) URL: provider keys ride in the path, query or host */
const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi;
// viem appends request params as a single `Request body: {...}` meta line to
// error.message. Hex addresses, calldata and topics can contain `429`, which
// must never turn a deterministic revert into a provider rate limit.
const REQUEST_BODY_LINE = /^Request body:[^\r\n]*(?:\r?\n)?/gim;
const AUTH_IN_TEXT = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
/** sk-orbio-…, sk-or-v1-…, sk-ant-… (same shape as the orbio probe's redaction) */
const API_KEY_IN_TEXT = /\bsk-[a-z0-9]+-[A-Za-z0-9_-]{4,}/gi;

/** viem nests the provider's text in `details` / `cause`; walk a bounded chain */
const MAX_CAUSE_DEPTH = 8;

/** The text classification reads: names, short messages, details and messages
 *  down a bounded cause chain. URLs are dropped: viem puts the endpoint in every
 *  message, and a host like `nd-429-…` or `…-network…` is not a failure.
 *  Exported (review 896555be) so a consumer's own context-specific signals, like
 *  the watcher's lag set, read exactly the same text. */
export function rpcErrorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof e !== 'object') {
      parts.push(String(e));
      break;
    }
    const o = e as { name?: unknown; shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown };
    for (const v of [o.name, o.shortMessage, o.details, o.message]) {
      if (typeof v === 'string' && v) parts.push(v);
    }
    e = o.cause;
  }
  return parts.join('\n').replace(REQUEST_BODY_LINE, ' ').replace(URL_IN_TEXT, ' ');
}

/** Every kind the error's text (message, details, names and causes) shows, in
 *  precedence order; empty when none. Consumers with their own retry context map
 *  from this rather than re-matching message text. */
export function rpcErrorKinds(err: unknown): RpcErrorKind[] {
  const text = rpcErrorText(err);
  return KIND_PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

export function classifyRpcError(err: unknown): RpcErrorKind {
  return rpcErrorKinds(err)[0] ?? 'unknown';
}

/** The provider, not the chain, failed: retry later, never grade. */
export function isProviderFailureKind(kind: RpcErrorKind): boolean {
  return kind === 'quota' || kind === 'rate_limit' || kind === 'transport';
}

/** Any provider-failure signal at all, even when the text also names an archive
 *  miss or a revert. For retry decisions, where a wrong "retry" costs a backoff
 *  and a wrong "don't" can cost a row. Package 4b: a cancelled request never
 *  reached the chain either, so it counts — no fallback may be cached from it. */
export function hasProviderFailure(err: unknown): boolean {
  return isRpcCancelled(err) || rpcErrorKinds(err).some(isProviderFailureKind);
}

/**
 * Review d1286de9: viem error messages carry the full RPC URL ("URL: https://…/KEY"),
 * and first-line truncation only hides it for viem's own layout. Text headed for
 * a database column or a log goes through this; classification keeps reading the
 * original error.
 */
export function redactRpcDiagnostic(text: string): string {
  return text
    .replace(URL_IN_TEXT, '[redacted-url]')
    .replace(AUTH_IN_TEXT, '$1 [redacted]')
    .replace(API_KEY_IN_TEXT, 'sk-REDACTED');
}
