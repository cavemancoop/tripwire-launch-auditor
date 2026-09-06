import { COMMIT_REGISTRY_ABI, getWalletClient } from '@launch-auditor/chain';
import { Prisma, prisma } from '@launch-auditor/db';
import { getBudgetedClient, PRIORITY } from '@launch-auditor/rpc-budget';
import { decodeEventLog, type Hex } from 'viem';
import { loadEnv, type WorkerEnv } from '../env';
import { ARTIFACT_KIND, computeArtifactHashes } from './artifacts';
import { buildMerkleTree } from './merkle';

export interface CommitResult {
  committed: boolean;
  batchId?: number;
  root?: Hex;
  leafCount?: number;
  txHash?: Hex;
  reason?: string;
}

function requireCommitEnv(env: WorkerEnv):
  | { ok: true; pk: Hex; registry: Hex }
  | { ok: false; reason: string } {
  if (!env.gasWalletPrivateKey) return { ok: false, reason: 'GAS_WALLET_PRIVATE_KEY not set' };
  if (!env.commitRegistryAddress) return { ok: false, reason: 'COMMIT_REGISTRY_ADDRESS not set' };
  return { ok: true, pk: env.gasWalletPrivateKey, registry: env.commitRegistryAddress };
}

/** One-time: commit the frozen weights / feature-code / outcome-rule hashes. */
export async function ensureArtifactsCommitted(): Promise<{ committed: number }> {
  const env = loadEnv();
  const cfg = requireCommitEnv(env);
  if (!cfg.ok) return { committed: 0 };
  if (await prisma.commit.findFirst({ where: { kind: 'ARTIFACT' } })) return { committed: 0 };

  const h = computeArtifactHashes();
  const wallet = getWalletClient(env.rpcUrl, cfg.pk);
  const pub = getBudgetedClient(env.rpcUrl, { priority: PRIORITY.commit });
  const items: { label: string; kind: Hex; hash: Hex; column: 'weightHash' | 'featureCodeHash' | 'outcomeRuleHash' }[] = [
    { label: 'weights', kind: ARTIFACT_KIND.weights, hash: h.weights, column: 'weightHash' },
    { label: 'feature_code', kind: ARTIFACT_KIND.featureCode, hash: h.featureCode, column: 'featureCodeHash' },
    { label: 'outcome_rule', kind: ARTIFACT_KIND.outcomeRule, hash: h.outcomeRule, column: 'outcomeRuleHash' },
  ];

  let committed = 0;
  for (const it of items) {
    const txHash = await wallet.writeContract({
      address: cfg.registry,
      abi: COMMIT_REGISTRY_ABI,
      functionName: 'commitArtifact',
      args: [it.kind, it.hash],
      account: wallet.account!,
      chain: wallet.chain,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    const base = {
      kind: 'ARTIFACT' as const,
      chainId: env.chainId,
      merkleRoot: it.hash,
      leafCount: 0,
      txHash,
      blockNumber: receipt.blockNumber,
      committedAt: new Date(),
    };
    await prisma.commit.create({
      data:
        it.column === 'weightHash'
          ? { ...base, weightHash: it.hash }
          : it.column === 'featureCodeHash'
            ? { ...base, featureCodeHash: it.hash }
            : { ...base, outcomeRuleHash: it.hash },
    });
    committed += 1;
    // eslint-disable-next-line no-console
    console.log(`[commit] artifact ${it.label} ${it.hash} -> ${txHash}`);
  }
  return { committed };
}

/**
 * Merkle-batch the validated, uncommitted report hashes and post the root
 * on-chain (spec §6): every `commit.intervalSec` or `commit.maxLeaves` leaves.
 */
export async function runCommitJob(opts: { force?: boolean } = {}): Promise<CommitResult> {
  const env = loadEnv();
  const cfg = requireCommitEnv(env);
  if (!cfg.ok) return { committed: false, reason: cfg.reason };

  await ensureArtifactsCommitted();

  const pending = await prisma.report.findMany({
    where: { validatorPassed: true, commitId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reportHash: true, createdAt: true },
  });
  if (pending.length === 0) return { committed: false, reason: 'nothing pending' };

  const oldestAgeSec = (Date.now() - pending[0]!.createdAt.getTime()) / 1000;
  const ready =
    opts.force ||
    pending.length >= env.commitMaxLeaves ||
    oldestAgeSec >= env.commitIntervalSec;
  if (!ready) {
    return {
      committed: false,
      reason: `waiting — ${pending.length}/${env.commitMaxLeaves} leaves, oldest ${Math.round(oldestAgeSec)}s/${env.commitIntervalSec}s`,
    };
  }

  const batch = pending.slice(0, env.commitMaxLeaves);
  const tree = buildMerkleTree(batch.map((r) => r.reportHash as Hex));

  const wallet = getWalletClient(env.rpcUrl, cfg.pk);
  const pub = getBudgetedClient(env.rpcUrl, { priority: PRIORITY.commit });
  const txHash = await wallet.writeContract({
    address: cfg.registry,
    abi: COMMIT_REGISTRY_ABI,
    functionName: 'commitBatch',
    args: [tree.root, BigInt(tree.leafCount)],
    account: wallet.account!,
    chain: wallet.chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    return { committed: false, reason: `commitBatch tx reverted (${txHash})` };
  }

  let batchId: number | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== cfg.registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: COMMIT_REGISTRY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === 'BatchCommitted') batchId = Number(ev.args.batchId);
    } catch {
      /* not our event */
    }
  }

  const leavesJson = batch.map((r) => {
    const h = (r.reportHash as string).toLowerCase();
    return { reportHash: h, index: tree.leaves.indexOf(h as Hex), proof: tree.proofs.get(h) ?? [] };
  });

  const commit = await prisma.commit.create({
    data: {
      kind: 'REPORT_BATCH',
      chainId: env.chainId,
      merkleRoot: tree.root,
      leafCount: tree.leafCount,
      leaves: leavesJson as unknown as Prisma.InputJsonValue,
      txHash,
      blockNumber: receipt.blockNumber,
      committedAt: new Date(),
    },
  });

  await prisma.$transaction(
    batch.map((r) =>
      prisma.report.update({
        where: { id: r.id },
        data: { commitId: commit.id, merkleLeafHash: (r.reportHash as string).toLowerCase() },
      }),
    ),
  );

  // eslint-disable-next-line no-console
  console.log(`[commit] batch ${batchId} root ${tree.root} (${tree.leafCount} leaves) -> ${txHash}`);
  return { committed: true, batchId, root: tree.root, leafCount: tree.leafCount, txHash };
}

export interface StopSignal {
  stopped: boolean;
}

export async function runCommitLoop(signal: StopSignal): Promise<void> {
  const env = loadEnv();
  const tickMs = Math.min(env.commitIntervalSec, 60) * 1000;
  while (!signal.stopped) {
    try {
      const r = await runCommitJob();
      if (r.committed) {
        // logged inside runCommitJob
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[commit] loop error', err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, tickMs));
  }
}
