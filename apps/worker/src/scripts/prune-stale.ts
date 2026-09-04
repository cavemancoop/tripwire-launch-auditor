import { getChainConfig } from '@launch-auditor/chain';
import { prisma } from '@launch-auditor/db';
import { loadEnv } from '../env';
import { blockscout } from '../watcher/blockscoutClient';
import { checkTokenFreshness } from '../watcher/freshness';

// pnpm watcher:prune-stale [--apply]
//   Re-checks every indexed launch's token freshness (spec §0: new-token
//   launches only) and reports — or with --apply, deletes — ones that turn
//   out to be a fresh pool for an already-established token (e.g. a
//   tokenized stock paired with USDG). Dry run by default.

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { chainId } = loadEnv();
  const bs = blockscout();
  const explorer = getChainConfig(chainId).explorer;

  const launches = await prisma.launch.findMany({
    where: { chainId },
    orderBy: { launchBlock: 'asc' },
  });
  console.log(`checking ${launches.length} launches (2 Blockscout calls each)...`);

  let stale = 0;
  for (const l of launches) {
    const r = await checkTokenFreshness(bs, l.tokenAddress, l.launchBlock);
    if (!r.isFreshLaunch) {
      stale += 1;
      console.log(
        `${apply ? 'DELETING' : 'STALE   '} ${l.tokenAddress}` +
          ` (existed ${r.ageBlocksAtPool} blocks before its pool)  ${explorer}/token/${l.tokenAddress}`,
      );
      if (apply) await prisma.launch.delete({ where: { id: l.id } });
    }
    await new Promise((res) => setTimeout(res, 120)); // be polite to the public API
  }

  console.log(
    `${stale} of ${launches.length} were not new-token launches.` +
      (apply ? ' Deleted.' : ' Re-run with --apply to delete them.'),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
