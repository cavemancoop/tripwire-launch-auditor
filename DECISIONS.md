# Decisions

Standing choices that aren't obvious from the code. Newest first.

## Checkpoint after M3 — Fable's calls on the mid-build review (2026-09-05)

Full memo: `checkpoint-decisions-m4.md`. Mid-build review: `midbuild-review-m0-m3.md`.
Both at repo root. Nothing here reopens M0–M3.

- **Data layer:** RPC + ScanHood + our own log reconstruction. No Blockscout at
  runtime (Cloudflare 403); its URLs are human-readable evidence only. M4 adds a
  `packages/rpc-budget` global token bucket + priority queue (watcher > commit >
  outcomes > deepdive > backfill) + response cache, and one `AddressHistoryProvider`
  interface (RPC-logs impl now, indexer later). Probe + use the RPC's real
  `eth_getLogs` range limit.
- **Launchpad attribution:** confirm Pons + LONG by **runtime code hash**
  (`keccak256(eth_getCode(token))`; launchpad tokens share a template), factory
  address second. $ORBIO is the Pons specimen. Blocks the backfill, not M4 code.
  `lp_locked_by_construction` = true only after on-chain custody verification of
  one real position; unverified stays `unknown` and keeps being scored for
  SELL/LIQ (conservative).
- **Freshness gate:** widen 1h → 24h token age at pool creation; store
  `token_age_at_pool_sec`. Tokenized stocks (code older than 24h at pool
  creation) are treated as the quote side; use ScanHood `rwa`.
- **`det_v0` priors:** run a 3-day partial backfill → observed base rates → set
  intercepts to `logit(base rate)`, keep hand-set weight directions → version as
  **`det_v0.1`**, commit the new weights hash. Poor coverage (>70% null) outputs
  the base rate with `confidence: low`, not the logistic's null-vector guess.
  Existing `det_v0` reports stay as posted.
- **`sell_impact_bps`:** RPC-only. Spot price from a tiny Quoter quote, then quote
  sells sized to **100 and 1,000 USDG**; store `sell_impact_bps_100` /
  `sell_impact_bps_1000`. ScanHood `priceUsd` is corroboration only.
- **Cluster rule 4:** ship disabled; keep the `FirstInboundLookup` interface.
- **Backfill scope:** 14 days, not 45. Print a call-count estimate before running;
  enforce `--max-calls`.
- **RevenueSplitter contract:** deferred / not built. The 2% → ZachXBT is a
  periodic **manual transfer** from `REVENUE_ADDRESS`, logged publicly
  (spec §0.1 — minimise money-handling surface). Supersedes the section below.

Rewritten M4 build prompt and M6 tool list are in `checkpoint-decisions-m4.md`
§C / §D. Order of operations: (1) Cooper does Pons+LONG attribution in a browser,
(2) M4 code + a 3-day pass, (3) choose `det_v0.1` intercepts, (4) 14-day backfill
in the background while M5 starts.

## Revenue split — 2% of gross to ZachXBT, in perpetuity (2026-09-05)

> **Superseded 2026-09-05 by the checkpoint above:** no splitter contract. The
> 2% is a periodic manual transfer from `REVENUE_ADDRESS`, logged publicly. The
> percentage, recipient and rationale below still stand.

A fixed **2.00% (200 bps)** of gross USDG revenue routes to
**`0x6eA158145907a1fAc74016087611913A96d96624`** (ZachXBT's public donation
address, for now) as a no-strings thank-you. The rest goes to the operator's
plain `REVENUE_ADDRESS`.

**Mechanism (build in M7):** a small `RevenueSplitter` contract on chain 4663 is
the x402 payee, so every paid call splits at receipt — on-chain and publicly
verifiable, no keeper, no discretion. Prefer a pull pattern (`release(token)`)
or immediate forward; USDG only. Not a treasury router — no token buys, no
schedule (those were cut in spec §11). The split % and recipient are contract
constructor args / immutables; changing them = deploy a new splitter and
re-point `REVENUE_ADDRESS` / the x402 payee.

Config: `.env` `REVENUE_SPLITTER_ADDRESS`, `SPLIT_ZACHXBT_BPS`,
`SPLIT_ZACHXBT_ADDRESS`.

Rationale: the v0.4 Trace layer (spec §10.1) is modelled on ZachXBT's fund-tracing
work; this is an explicit, transparent acknowledgement rather than just a credit
line. He is not involved in or endorsing the project.
