/**
 * Independent check of a `/v1/receipt/:hash` response. Trusts nothing the
 * server says about itself: the signed message is rebuilt from the canonical
 * bytes' own fields (not the receipt's `eip712.message`), the hash is
 * recomputed from those bytes, the Merkle proof is folded locally, and the
 * root, block and timestamp are read from any RPC the caller chooses.
 */
import { classifyEligibility, horizonToMs, type Eligibility } from '@launch-auditor/scoring';
import {
  concatHex,
  createPublicClient,
  http,
  keccak256,
  parseAbiItem,
  recoverTypedDataAddress,
  stringToHex,
  type Hex,
} from 'viem';
import { REPORT_COMMITMENT_TYPES, type Receipt } from './receipt';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Content {
  chainId?: number;
  tokenAddress?: string;
  reportTime?: string;
  forecaster?: string;
}

function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() <= b.toLowerCase() ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a]));
}

/** Everything that needs no network: bytes → hash → signer → Merkle root. */
export async function verifyReceiptOffline(
  receipt: Receipt,
  expectedHash: string,
  expectedSigner: string,
): Promise<Check[]> {
  const checks: Check[] = [];
  const recomputed = keccak256(stringToHex(receipt.canonicalJson));
  checks.push({
    name: 'hash',
    ok: recomputed.toLowerCase() === expectedHash.toLowerCase(),
    detail: `keccak256(canonicalJson) = ${recomputed}`,
  });

  let content: Content;
  try {
    content = JSON.parse(receipt.canonicalJson) as Content;
  } catch {
    checks.push({ name: 'signature', ok: false, detail: 'canonicalJson does not parse' });
    return checks;
  }
  const reportTimeSec = content.reportTime ? Math.floor(Date.parse(content.reportTime) / 1000) : NaN;
  if (!receipt.signature || content.chainId == null || !content.tokenAddress || !content.forecaster || Number.isNaN(reportTimeSec)) {
    checks.push({ name: 'signature', ok: false, detail: 'unsigned, or the canonical content lacks chainId/tokenAddress/reportTime/forecaster' });
  } else {
    let recovered = '';
    try {
      recovered = await recoverTypedDataAddress({
        domain: { name: 'LaunchAuditor', version: '1', chainId: content.chainId },
        types: REPORT_COMMITMENT_TYPES,
        primaryType: 'ReportCommitment',
        message: {
          reportHash: recomputed,
          chainId: BigInt(content.chainId),
          token: content.tokenAddress as Hex,
          reportTime: BigInt(reportTimeSec),
          forecaster: content.forecaster,
        },
        signature: receipt.signature as Hex,
      });
    } catch (err) {
      recovered = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    checks.push({
      name: 'signature',
      ok: recovered.toLowerCase() === expectedSigner.toLowerCase(),
      detail: `EIP-712 signer recovered from the canonical content = ${recovered}`,
    });
  }

  const { proof, merkleRoot } = receipt.commit;
  if (!proof || !merkleRoot) {
    checks.push({ name: 'merkle', ok: false, detail: 'no Merkle proof — the report is not in a committed batch' });
  } else {
    let node = recomputed.toLowerCase() as Hex;
    for (const sibling of proof) node = hashPair(node, sibling as Hex);
    checks.push({
      name: 'merkle',
      ok: node.toLowerCase() === merkleRoot.toLowerCase(),
      detail: `folded proof (${proof.length} siblings) = ${node}`,
    });
  }
  return checks;
}

const BATCH_COMMITTED = parseAbiItem(
  'event BatchCommitted(uint256 indexed batchId, bytes32 merkleRoot, uint256 leafCount, uint256 timestamp)',
);

async function retry<T>(f: () => Promise<T>, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await f();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}

/** The chain half: the root is in a BatchCommitted event from the registry, and the block's own timestamp. */
export async function verifyReceiptOnChain(
  receipt: Receipt,
  rpcUrl: string,
  registry: string,
): Promise<{ checks: Check[]; blockTime: Date | null }> {
  const { blockNumber, merkleRoot } = receipt.commit;
  if (blockNumber == null || !merkleRoot) {
    return { checks: [{ name: 'on-chain root', ok: false, detail: 'not committed' }], blockTime: null };
  }
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 20_000 }) });
  const bn = BigInt(blockNumber);
  const [logs, block] = await Promise.all([
    retry(() => client.getLogs({ address: registry as Hex, event: BATCH_COMMITTED, fromBlock: bn, toBlock: bn })),
    retry(() => client.getBlock({ blockNumber: bn })),
  ]);
  const found = logs.some((l) => (l.args.merkleRoot as string | undefined)?.toLowerCase() === merkleRoot.toLowerCase());
  const blockTime = new Date(Number(block.timestamp) * 1000);
  return {
    checks: [
      {
        name: 'on-chain root',
        ok: found,
        detail: `BatchCommitted(${merkleRoot.slice(0, 10)}…) ${found ? 'found' : 'NOT found'} in block ${blockNumber} of registry ${registry}`,
      },
      { name: 'block time', ok: true, detail: `block ${blockNumber} timestamp ${blockTime.toISOString()} (read from chain)` },
    ],
    blockTime,
  };
}

/** Each outcome's eligibility recomputed from the chain's block time, not the server's. */
export function eligibilityFromChain(receipt: Receipt, blockTime: Date | null): Array<{ outcome: string; eligibility: Eligibility }> {
  const content = JSON.parse(receipt.canonicalJson) as Content;
  const anchor = new Date(content.reportTime ?? 0);
  return receipt.outcomes.map((o) => ({
    outcome: `${o.label}@${o.horizon}`,
    eligibility: classifyEligibility({
      reportTime: anchor,
      committed: receipt.commit.committed,
      commitBlockTime: blockTime,
      horizonEnd: new Date(anchor.getTime() + horizonToMs(o.horizon)),
    }),
  }));
}
