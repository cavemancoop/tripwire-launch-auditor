# Closer Plan — Launch Auditor, 14 September 2026

Response to the engagement brief and `HANDOFF-2026-09-14.md`. Every claim below about current state comes from the handoff's §7 verification commands or from the live Orbio pages fetched today; where I couldn't verify, I say so.

---

## 0. Ground truth

**Stage.** Still in the build window. Orbio's contest page today: Build until 20 Sept, Judging until 23 Sept, prizes vest over 30 days, 44 builders approved, `@cooopdetat` approved 3 Sept. That is six days of build, not "days left" in the abstract. The handoff's plan was written as if judging were imminent; it isn't, and that changes the sequencing: there is time to let production earn its track record on live data before a judge sees it.

**Live on-chain and in production (verified via the handoff's endpoints):** watcher at ~6s staleness; commit loop landing batches every 5 minutes from Railway; 3,242 launches and 6,130 reports in 24h; of the 200 newest launches, 108 have a `det_v0` forecast and 102 are committed (the rest are younger than T+10m — the sampling trap the handoff names); a 1,602-row benchmark that is 100% live, with `INSIDER_EXIT@6h` at n=204 and `SELL_IMPAIRED@1h` at n=288 for the arithmetic forecasters.

**Not live, despite being built and tested:** Orbio. Zero lifecycle rows, zero deep-dives, zero spend, Metabolism panel all `n/a`. `dailyDeepdiveBudget()` — property 2 of the spec, the accrual-driven budget — exists and is never called. Telegram feed and alerts off (two env vars). Dashboard shows nothing until a visitor pastes the API URL. x402 never built. M10 (DEMO.md, summary, public repo, license) not started.

**Stale in the handoff:** the assumption that judging is near; the MCP tool names in older docs (`orbio_claim_key`/`orbio_rotate_key` are now `orbio_create_key`, which mints and retires in one call — the code already matches this empirically, but every doc should); and possibly the `web_search` failure, since Orbio says it ships features daily and the gateway error may already be fixed.

**Claims that need re-checking before they appear anywhere public:** (a) `INSIDER_EXIT@6h` at n=204 with a ~12% base rate is ~24 positives, below the project's own ≥30-positives rule — it clears the n bar, not the claim bar; (b) `SELL_IMPAIRED@1h` at n=288 — confirm this is the resized outcome (notional = 2% of liquidity at report time), not the fixed-$100 version that reads 96% true; if it's the old one, the cell is descriptive, not scoreable, and must not be presented as a claim.

**Financial ground truth:** Railway trial has ~$5 of credit left with five services running continuously. That is a mid-judging outage waiting to happen and is the cheapest problem in this document to prevent.

---

## 1. Verdict

Keep the design. Do not redesign anything. The architecture is right, the production instance is real, and the honest benchmark is a genuinely rare asset. The failure is narrower than the handoff's headline makes it sound: the Orbio-specific properties aren't absent from the design, they're absent from the deployed instance — one is dead code with a 40-line fix, the other is a deployment gap with an honest bound. Close those two, fix the two demo-killers (dashboard URL, Telegram vars), let production run for four days, ship M10. Cut nothing that's working; leave the inert scaffolding inert and off the public surface.

What I'd explicitly not do this week: touch the §3 architecture calls (Postgres-as-IPC, entrypoint migrations, dual-scope scoring — all acceptable at current scale), restore `web_search` by patching the SDK, merge the backfill into production, build x402, or add any feature. Confidence in this verdict: high. It would change if the key-endpoint probe in §3 step 3 fails and the OAuth bound turns out to stop inference itself rather than only lifecycle management — then the continuity story needs a different shape (see §7).

---

## 2. Design changes (small, and all in service of the Orbio-specific test)

### 2.1 Separate the two continuities
The handoff treats "Orbio continuity" as one problem bounded by a ~1h OAuth session. It's two:

- **Inference continuity.** The `sk-orbio-…` key the agent created spends the balance live at the gateway. Nothing about that key expires when the OAuth session does. Inference and, if the budget can read the key's own usage, the accrual-driven budget continue indefinitely as long as the balance is positive.
- **Lifecycle-management continuity.** Creating a replacement key, revoking, and reading balance through the MCP need the session, which lasts ~1h with a one-shot refresh.

Design change: make the live budget and the "billing stale" gate read from the key itself when the MCP session is absent, and reserve the MCP session for create/revoke and for reconciliation when it's present. The Orbio gateway is OpenRouter-compatible; OpenRouter exposes `GET /api/v1/key` (limit, usage, remaining) for the bearer key. Probe whether `https://api.orbio.so/api/v1/key` does the same. If it does, property 2 runs unattended with no session at all, and the honest bound becomes: "inference and budget: unbounded while balance > 0; key replacement and revocation: require a session, re-established daily by the operator." If it doesn't, fall back to §2.3.

### 2.2 Wire property 2 exactly as the handoff scoped it
`trailingCreditsUsd` = sum of positive deltas between consecutive balance snapshots over 24h, excluding deltas tagged as revoke refunds. Feed `dailyDeepdiveBudget()`; have `deepdiveRunGate()` use the three-term min; surface `bindingConstraint` on the panel. On the honesty question (§6.2 of the handoff): a derived accrual is honest if the dashboard says "credits accrued, derived from balance snapshots" and shows the snapshots, and if the label switches to a first-class number the moment Orbio exposes one. The claim it supports is "the daily research budget is a function of measured accrual," which is exactly true. It does not support "throughput follows token trading in real time" beyond what the snapshots show — don't write that.

### 2.3 Continuity deployment, chosen by the probe
- If the key endpoint works: seed the created key into Railway as an env var; the worker runs inference and budget from key reads; the MCP session is established once a day from Cooper's laptop with `pnpm orbio:auth --push`, which writes the token store to Railway via `railway variables set` and triggers a redeploy. Lifecycle rows continue to be written for every snapshot; the panel shows "session: active until HH:MM UTC / paused" as a first-class field.
- If it doesn't: same daily push, but inference stops when the session expires unless the key is pre-created and long-lived — test that explicitly (create a key, let the session die, call the gateway an hour later). Either way, publish the bound as a number on the panel, exactly as the handoff proposed. Do not expose an OAuth callback publicly on the worker; it adds attack surface for no gain.
- Raise the one-shot refresh with Orbio in the builders channel today, as a bug report with the request/response. They ship daily; there is a real chance this is fixed before judging, and asking costs nothing.

### 2.4 Two datasets, labeled, not merged
Production stays 100% live through judging. After judging, import the backfill as `retrospective=true` rows; the dual-scope snapshot and the "+N retro" badge already exist, so the dashboard can show base-rate context without contaminating the live number. Rationale: a judge who sees "every row was precommitted before its outcome, zero backfill" is seeing the rarest property this project has.

### 2.5 Make swallowed failures visible
The 2-day pool-derivation bug was invisible because a broad `try/catch` logged a warning. Add a per-catch-site failure counter to `/metrics` and an ops alert when any counter exceeds a threshold over 10 minutes. This is the systemic fix; the handoff's own §3.6 note about `withRetry` implies this class isn't unique. One session, mostly mechanical.

---

## 3. Steps, in dependency order

Day 0 (today, ~2 hours of Claude Code): 
1. Dashboard API-URL fix — build-time env or a `/config.json` served by the web container. Demo-killer; 10 lines.
2. Set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHANNEL_ID` on the Railway worker. Free feed and ops alerts come on.
3. Railway: move off the trial before it runs dry mid-judging (Hobby plan; consolidate to fewer services if cost matters).
4. Probe `GET https://api.orbio.so/api/v1/key` with the agent's key; record the response shape in CHANGELOG.

Day 1:
5. Wire property 2 (§2.2). Tests: budget varies with synthetic accrual; gate uses the min; panel shows `bindingConstraint`.
6. Continuity per §2.3. Seed key/token, verify first production lifecycle row, first production deep-dive with cost in the ledger, panel populated.
7. Post the refresh-grant bug to Orbio.

Day 2:
8. Failure counters on every catch site + alert (§2.5).
9. Re-check the two benchmark claims from §0; add the ≥30-positives rule to the dashboard's claim gate if it isn't already enforced there.
10. Re-test `web_search` through the gateway once; if it still fails, leave it off and keep the documented limitation.

Days 3–5: let it run. Production is accruing ~200–300 resolved outcomes per cell per day; four days clears the claim bar on live data in the cells that matter. Daily: re-auth push, read the ops channel, check `/metrics` failure counters.

Day 5–6: M10. DEMO.md (five-minute judge path: feed → proof on Blockscout → benchmark with sample sizes → Metabolism panel with binding constraint and session bound → lifecycle log), 200-word summary, secret scan of the full git history (`gitleaks` or equivalent; the repo was force-pushed and the OAuth store must never have been committed), MIT license, repo public.

Parallel at any time: outreach to two or three bot/terminal operators using the free feed and the benchmark as the pitch. Not for the contest — for the demand gate that decides what happens after 23 Sept.

---

## 4. What has to be in place (Cooper's list)

- Railway billing upgraded today; five services will not survive judging on $5.
- Telegram bot token and a public channel for the feed; a second private channel for ops alerts.
- Railway CLI linked on the laptop (already) for the daily `pnpm orbio:auth --push`; ~30 seconds a day.
- The Orbio balance: check it; the $100 grant plus boosted accrual should cover the deep-dive cap easily, but confirm before turning production spend on.
- Chainstack RPC plan headroom: the pool-derivation fix stopped a large retry burn; confirm the daily call budget is comfortable at 3,000+ launches/day.
- A decision on secrets: confirm `.orbio/token-store.enc.json` and `.env` were never committed in any historical commit before the repo goes public.
- Ten minutes in the Orbio builders channel to report the refresh bug and ask whether a first-class accrual endpoint exists.

---

## 5. Models and tools

- Deep-dive forecaster: keep `deepseek/deepseek-v4.1-flash`, pinned. It's the slug that works through the gateway with structured output, it has the first real graded-eligible report, and its cost (~$0.0015/run at the discounted rate) means the binding constraint on runs is qualified launches, not money. Changing the slug now would restart the forecaster's record; don't. After judging, add a stronger model as a second named forecaster so "does model quality matter" becomes a measured result.
- Gateway: Orbio's (`api.orbio.so/api/v1`), because that's the Orbio-specific property; usage recorded from provider-reconciled costs as the handoff does. `web_search` stays off unless the retest passes.
- RPC: Chainstack for production (paid, working, rejects rather than silently clamps — which is what caught the bug), Blockmachine locally. No new providers this week.
- External scanners as named baselines: ScanHood, GoPlus (already wired). RobinSight if any metric is reachable; otherwise not this week.
- Build: Claude Code on Cooper's own subscription, never on the Orbio key (one active key per account; the agent's rotation would kill the session). The OpenRouter MCP stays connected for slug/price checks; the Orbio MCP stays connected for tool-shape checks.
- Ops: Railway, Telegram, `/metrics` — no new dashboards or observability vendors.

---

## 6. Orchestration

Autonomous, no human: watcher, features, commits, outcome resolution, scorer snapshot every 5 minutes, deep-dive sweep under the budget gate, free-feed posting, ops alerts.

Daily human loop (Cooper, ~10 minutes): morning re-auth push; read ops channel; glance at `/metrics` failure counters and Metabolism panel; note the session-bound number.

Claude Code sessions: one milestone per session, plan first, verify with the handoff's own curl commands, commit, `/clear`. Standing autonomy rule for the week: Claude Code decides anything reversible and versioned on its own and records it; it asks only for credentials, money, on-chain irreversibles, and any change to public claims. Batch questions into one message per session.

Human checkpoints (must ask): any wording that goes on the dashboard or in DEMO.md about what is proven; any change to outcome rules, weights, or feature code (versioned + artifact hash committed); anything that spends Orbio balance above the daily cap; making the repo public.

---

## 7. Failure modes of this plan

- The key endpoint doesn't exist on Orbio's gateway and pre-created keys stop working when the session dies. Then unattended continuity is bounded at ~1h for inference too, and the honest panel says so; the daily push still yields ~1h of live metabolism per day for a judge to see. Mitigation: ask Orbio for either a longer session or a key-info endpoint; both are cheap for them.
- The refresh-grant behavior is a bug they fix mid-week and the code assumes one-shot. Make the token store handle both.
- Railway credit runs out or a service crash-loops during judging. Mitigation: billing today, health checks already exist, ops alerts on.
- A judge samples "recent launches" and sees zero forecasts (the T+10m trap). Mitigation: the dashboard's coverage stat is defined over eligible launches (age ≥ T+10m) with the rule stated on screen.
- The benchmark shows a claim that doesn't meet the positives rule. Mitigation: step 9.
- Another swallowed exception. Mitigation: §2.5.

What would change my verdict: if by day 2 the Metabolism panel still can't be populated in production by any honest route, the submission should lead with the benchmark and present Orbio as "funds the research budget; lifecycle demonstrated locally, bound published" rather than pretend otherwise. That is a weaker but still true story, and true beats strong here.

---

## 8. The vision — what this is when it's done

A public feed on Robinhood Chain where every new token gets a numbered forecast within seconds — "62% the creator cluster sells within six hours; 34% price is down 80% by tomorrow; 27% still trading in a day" — signed, hashed on-chain before anyone can know the answer, and graded later against what happened. Next to every forecast, the same grade for the public scanners' verdicts on the same launch, and later for the callers who promoted it. The agent that produces it pays for its own research out of credits that accrue to a wallet holding a token, sizes that research to what accrued yesterday, and writes every key it creates and revokes to a signed log; anyone holding the token can clone it and run their own.

- The trader sees three numbers and a hit rate before buying, and knows the hit rate can't have been edited.
- The bot engineer gets signed JSON at entry time and a benchmark table that tells them whether it beats the heuristic they wrote last month.
- The Orbio holder and the judge see an agent whose daily behavior visibly follows the credit stream, with the bound on unattended operation printed rather than hidden — the one part of the demo that would not exist on a plain key.
- The critic finds a project that publishes its blanks, its sample sizes, its two-day bug, and its two P&Ls, and has to argue with the scorer rather than the copy.
- Cooper, in six months, has a benchmark nobody else on the chain can publish, three integrations or a clear "no," a wallet index that compounds with every outcome, and a decision about the caller scorecard grounded in data rather than a hunch.
