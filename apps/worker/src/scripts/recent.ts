import { getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { loadEnv } from '../env';

// pnpm watcher:recent [n]
//   Print the most recent launches the watcher indexed, with Blockscout links
//   so a row can be checked against on-chain reality by hand.

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 10);
  const { chainId } = loadEnv();
  const explorer = getChainConfig(chainId).explorer;

  const rows = await prisma.launch.findMany({
    where: { chainId },
    orderBy: { launchBlock: 'desc' },
    take: n,
    include: { feature: true },
  });

  if (rows.length === 0) {
    console.log('no launches indexed yet — let `pnpm dev:worker` run a little longer');
    return;
  }

  for (const l of rows) {
    const f = l.feature;
    console.log('─'.repeat(72));
    console.log(`token    ${l.tokenAddress}   (${l.source}, conf ${l.sourceConfidence ?? '—'})`);
    console.log(
      `pool     ${l.poolKind ?? '?'}  ${l.poolAddress ?? l.poolId ?? '—'}   via ${l.detectedVia ?? '—'}`,
    );
    console.log(`creator  ${l.creatorAddress}${l.quotaExceeded ? '   [quota exceeded]' : ''}`);
    console.log(
      `block    ${l.launchBlock.toString()}   ${l.launchAt?.toISOString() ?? '—'}   quote ${l.quoteAddress ?? '—'}`,
    );
    console.log(
      `features devbuy=${f?.creatorDevbuyPct ?? '—'}%  buyers10m=${f?.uniqueBuyers10m ?? '—'}  buysPerBuyer=${
        f?.buysPerBuyer10m?.toFixed(2) ?? '—'
      }  t10=${f?.t10ComputedAt ? 'done' : 'pending'}`,
    );
    console.log(`  tx     ${explorer}/tx/${l.launchTxHash}`);
    console.log(`  token  ${explorer}/token/${l.tokenAddress}`);
    console.log(`  maker  ${explorer}/address/${l.creatorAddress}`);
  }
  console.log('─'.repeat(72));
  console.log(`${rows.length} shown of ${await prisma.launch.count({ where: { chainId } })} total`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
