# Checkpoint decisions — after M3, before M4

Read with `midbuild-review-m0-m3.md`. Each item states the call and the reason; the rewritten M4 and M6 prompts are at the end. Nothing here reopens M0–M3.

## A. Decisions on §8

### 8.1 Data layer: RPC + ScanHood + own log reconstruction (option b). Blessed.
Spend at most ten minutes on two Blockscout probes before moving on: a request with a real browser `User-Agent`/`Accept` header, and the Etherscan-compatible path (`/api?module=account&action=txlist&address=`), which is sometimes cached differently. If either works, wrap it behind the provider interface below as a bonus; do not plan around it. Self-hosted Blockscout or a paid indexer is the post-contest fix.

Because everything now goes through one 600 req/min RPC, M4 must add a global request budget (token bucket, priority queue: watcher > commit > outcomes > deep-dive > backfill, and a response cache keyed by chain/method/params/block). Probe the largest `eth_getLogs` range the RPC accepts (10k vs 20k) and use it; call counts scale with range size.

Define one `AddressHistoryProvider` interface with an RPC-logs implementation now (`eth_getLogs` on `Transfer` with indexed `from`/`to` topic filters, chunked). Bitquery or Blockscout implementations can slot in later without touching callers. This also gives M6 its address-activity tool.

### 8.2 Launchpad attribution: confirm Pons and LONG before the backfill. Blocker for backfill, not for M4 code.
Cheapest reliable method is runtime code hash, not factory events: launchpad tokens share a template, so `keccak256(eth_getCode(token))` (or the implementation behind an EIP-1167 minimal proxy) identifies the pad with no indexer at all. Procedure for Cooper in the browser: open the $ORBIO token on Blockscout (it is a Pons launch; orbio.so links the address), find its creation transaction, note the factory (`to` of the creation tx or the "created by contract" address) and copy the token's runtime bytecode hash; repeat for one LONG token from long.xyz. Put factory address + template hash + evidence tx into `config/chain.4663.json`. Attribute by hash first, factory second.

`lp_locked_by_construction` is set true only for pads where custody of one real position has been verified on-chain (owner of the v4 position or a hook that blocks removal), never from docs. Unverified stays `unknown`, and SELL/LIQ outcomes keep being scored for unknowns; that is the conservative direction.

Also widen the freshness gate from 1h to 24h of token age at pool creation and store `token_age_at_pool_sec`; a token deployed in the morning and pooled in the afternoon is still a launch, while a months-old tokenized stock is not.

### 8.3 `det_v0` priors: quick bias pass, then version. Yes.
Order: (1) run a 3-day partial backfill first (M4 step 3) to get rough base rates per outcome/horizon; (2) set each intercept to logit(observed base rate) and keep the hand-set weight directions; (3) when coverage is poor (the validator's >70% null rule), output the base rate with `confidence: low` rather than whatever the logistic produces on nulls; (4) version as `det_v0.1`, commit the new weights hash as an artifact, keep the already-committed `det_v0` reports as they are. Dashboard label: "det_v0.1 (priors, uncalibrated)".

### 8.4 `sell_impact_bps`: fixed USDG notional, two sizes. Yes, and make it RPC-only.
Spot price from a tiny Quoter quote (token → USDG), then size the sell to 100 and 1,000 USDG-equivalent and quote both; store `sell_impact_bps_100`, `sell_impact_bps_1000`. ScanHood `priceUsd` becomes corroboration, not a dependency. The 1,000 size is what the diligence skill calls "holder-sized" and is the one most predictive of exit pain.

### 8.5 Cluster rule 4: ship disabled. Yes.
Rules 1–3 are the load-bearing ones on launchpads (launch-block buy is the strongest). Leave the `FirstInboundLookup` interface in place; the RPC-logs provider from 8.1 covers ERC-20 inbound but not native ETH funding, so a true rule 4 waits for an indexer. Note it in the benchmark's coverage text.

### 8.6 Anything else
- RevenueSplitter (2% → ZachXBT): defer, and do not build a contract for it. It is a contract that holds and moves money, which is exactly the surface §0.1 says to minimize, and payments are last in the build order anyway. If payments ship, do the 2% as a manual periodic transfer from `REVENUE_ADDRESS`, logged publicly. Describe it as a donation; do not imply affiliation.
- Backfill scope: 14 days, not 45. At ~150–200 launches/day and roughly 300–600 RPC calls per token for full outcomes, 45 days is several days of RPC time at 600 req/min; 14 days already clears the 200-resolved-launch minimum for claims. Print a call-count estimate before starting and enforce `--max-calls`.
- Quote-asset list: add tokenized stocks (LONG pairs against them). Use ScanHood's `rwa` flag and the 24h age gate; anything with code older than 24h at pool creation is treated as the quote side.

## B. Calls on §5 deviations
- (a) open-string `source`: fine.
- (d) `heuristic_v1` one probability across cells: fine. Evaluate it primarily on AUROC (ranking), where a single flag is still meaningful; Brier will look bad by construction and the benchmark note should say why.
- (g) compact EIP-712 struct over the canonical hash: fine, standard.
- (i) minimal event-only CommitRegistry with gas-wallet owner: fine. Keep the gas key server-only; `rotateOwner` to a dedicated committer key after the contest.
- (k) coverage-ratio "unknown-as-pass" check: fine for the deterministic path. The binding version lands in M6: any diligence surface without evidence is rated `unknown`, never "no finding."
- (l) `has_x`/`has_site` null and `microbuy_share_10m` null: fine. Define microbuy as < 5 USDG notional once spot pricing (8.4) exists; leave socials null until a pad API is used on the qualified lane.
- Not in the table but worth stating: commit loop as `setInterval` is fine for one instance; it must be idempotent on restart (it is, since it batches uncommitted validated reports).

## C. Rewritten M4 prompt (replace the guide's)
```
Read launch-auditor-spec-v0.2.md, checkpoint-decisions-m4.md and midbuild-review-m0-m3.md. No Blockscout at runtime; RPC + ScanHood + our own logs only.

1. packages/rpc-budget: global token-bucket limiter (default 500 req/min, env-configurable), priority queue (watcher > commit > outcomes > deepdive > backfill), response cache keyed by chain/method/params/block, and a probe that determines the largest eth_getLogs range the RPC accepts and stores it in config. Route every RPC call through it.

2. Outcome resolution jobs at each horizon from spec §1, anchored to reportTime (spec §1.1):
   - Price: v4 PoolManager Swap logs filtered by poolId topic; derive price from the event's sqrtPriceX96; max price over the first 24h (or the 24h before reportTime for non-launch triggers); price at the horizon = last Swap before the horizon block, else a Quoter eth_call at that block. v2/v3 pools: Swap/Sync events equivalently.
   - Liquidity (raw tokens only): v4 ModifyLiquidity logs filtered by poolId plus the liquidity field on Swap; peak vs current; removal ≥ 80% → LIQ_IMPAIRED.
   - INSIDER_EXIT: token Transfer logs with from ∈ cluster wallets (topic array), over the horizon window; a sell is a Transfer from a cluster wallet to the PoolManager or a known router in a tx that also contains a Swap for this pool; compare to the cluster's peak holdings from balance reconstruction; ≥ 50% → true.
   - SELL_IMPAIRED: Quoter eth_call at the horizon block for the 100-USDG size; revert or effective tax ≥ 30% → true. Archive-call failure → outcome status `unresolved` with the reason, never false.
   - Every outcome row stores blocks scanned, chunk size, call count, and gaps as `coverage`.

3. Scorer package with CLI: metrics per spec §2 (AUROC, AUPRC, log loss, Brier, Brier skill vs trailing-30-day base rate, ECE, precision/recall at 0.5 and configurable thresholds), DeLong comparison, "insufficient sample" below 100 resolved and no superiority claims below 200; splits by trigger type and by source. Forecasters: base_rate, heuristic_v1, det_v0, det_v0.1, scanhood, goplus. Publish the fixed [0,1] mappings for scanhood (verdict → probability) and goplus (flag count → probability) in a JSON file and commit its hash as an artifact.

4. Backfill: `pnpm backfill --days 14 --max-calls N`. Step order: attribute sources (code-hash then factory), index launches, features (frozen code), DRAWDOWN_80 for all launches via the Swap-log method, cluster + INSIDER_EXIT + SELL_IMPAIRED for qualified launches only (liquidity ≥ 2,000 USDG or ≥ 25 unique buyers). Print the call estimate before running and mark rows retrospective=true. Run a 3-day pass first and print observed base rates so I can set det_v0.1 intercepts.

5. Implement the 8.4 sell-size change (100 and 1,000 USDG notionals via Quoter spot) and the 24h freshness gate with token_age_at_pool_sec. Add tests with recorded fixtures; no live RPC in tests.
```

## D. Rewritten M6 tool list (for the deep-dive prompt)
Replace `blockscout_address` / `blockscout_txs` with: `address_token_activity(address, token?, fromBlock, toBlock)` via the AddressHistoryProvider; `token_transfers(token, fromBlock, toBlock)`; `cluster_expand(creator)`; `price_series(poolId, fromBlock, toBlock)` from Swap logs; `holder_snapshot(token, block)` from reconstructed balances; `contract_code(address)` returning code hash, size, EIP-1967 proxy slots and implementation; `scanhood_scan(token)`; `scanhood_quote(token, sizeUsdg)`; and OpenRouter's `web_search` server tool. Evidence rows may include a Blockscout URL for human readers, but the agent never fetches it. Everything else in the M6 prompt stands.

## E. Order of operations from here
1. Cooper: Pons + LONG attribution in the browser (8.2), ~30 minutes. Add to config with evidence.
2. Claude Code: M4 with the prompt above; run the 3-day pass; report base rates.
3. Cooper: choose intercepts (or accept the observed base rates as-is); Claude Code versions det_v0.1 and commits the artifact.
4. Full 14-day backfill runs in the background while M5 starts.
