import { describe, expect, it } from 'vitest';
import { classifyRpcError, redactRpcDiagnostic } from '../src/errors';

// Review d1286de9: diagnostic text from viem carries the key-bearing RPC URL.
const VIEM_MESSAGE =
  'RPC Request failed.\n\nURL: https://nd-123-456-789.p2pify.com/S3CR3TKEYd00d\nRequest body: {"method":"eth_getLogs"}\n\nDetails: fetch failed\nVersion: viem@2';

describe('redactRpcDiagnostic', () => {
  it('removes the key-bearing URL from a viem message and keeps the provider text', () => {
    const out = redactRpcDiagnostic(VIEM_MESSAGE);
    expect(out).not.toContain('S3CR3TKEYd00d');
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).toContain('URL: [redacted-url]');
    expect(out).toContain('Details: fetch failed');
    expect(out).toContain('"method":"eth_getLogs"');
  });

  it('covers query-string keys, websocket URLs, auth headers and sk- keys', () => {
    const out = redactRpcDiagnostic(
      'a https://eth.example/v3?apikey=QK1 b wss://ws.example/Q2K c Authorization: Bearer abc.DEF-123 d sk-or-v1-abcd_EF12',
    );
    for (const secret of ['QK1', 'Q2K', 'abc.DEF-123', 'abcd_EF12']) expect(out).not.toContain(secret);
    expect(out).toBe('a [redacted-url] b [redacted-url] c Authorization: Bearer [redacted] d sk-REDACTED');
  });

  it('leaves URL-free text untouched', () => {
    expect(redactRpcDiagnostic("You've reached your monthly quota of Request Units")).toBe(
      "You've reached your monthly quota of Request Units",
    );
  });

  it('is for output only: classification of the redacted text is unchanged', () => {
    expect(classifyRpcError(new Error(redactRpcDiagnostic(VIEM_MESSAGE)))).toBe(classifyRpcError(new Error(VIEM_MESSAGE)));
  });
});
