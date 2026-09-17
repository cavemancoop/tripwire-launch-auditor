# Wording pass — for Cooper's approval before it goes anywhere public

Every public string that needs to change, as a diff, with why. Nothing here has
been applied yet. Say yes to all, or mark exceptions, and I'll apply exactly
what you approve to README.md, launch-auditor-spec-v0.2.md, and the dashboard
copy already shipped (index.html/app.js structure is done; this is the prose).

Snapshot facts this draft is built from (repo `main` @ `8b8d10f`, 2026-09-16
~23:30 UTC): 5,700 launches/24h, 14k+ reports/24h. Benchmark (live section):
`DRAWDOWN_80@24h`, `INSIDER_EXIT@6h`/`@24h`, `LIQ_IMPAIRED@24h`,
`SELL_IMPAIRED@1h`/`@24h`, `TRADING_ALIVE@24h` all have live cells; `det_v0`
clears the claim bar (beats a baseline, DeLong-significant) on
`LIQ_IMPAIRED@24h` and `TRADING_ALIVE@24h` only — its Brier Skill is negative
on every cell, meaning its probabilities are not yet well-calibrated even where
its ranking beats a baseline. That recalibration (`det_v0.1`, spec'd in
DECISIONS.md, not yet applied) is separately flagged in DEMO.md as known-open.

---

## 1. Outcome count: "four" vs "five" vs eleven cells

**Where:** README.md:3 ("four mechanically-defined outcomes"), spec §0
("four … outcomes"). The actual set is **five** outcomes
(`INSIDER_EXIT`, `SELL_IMPAIRED`, `LIQ_IMPAIRED`, `DRAWDOWN_80`,
`TRADING_ALIVE`) across **eleven** outcome×horizon cells (spec §1).

**Proposed:** both instances → "five mechanically-defined outcomes, at fixed
horizons (eleven outcome×horizon cells in total)".

## 2. "The forecast existed before the outcome" — true only for committed reports

**Where:** README.md:9, spec §0, dashboard footer.

No change to the sentence — it's accurate as a description of what commitment
proves. What needs adding, wherever the sentence appears standalone: a note
that not every report is committed at the moment it's read (the commit loop
batches every 5 minutes / 200 leaves), with the live coverage number from
`/metrics` (`launch_auditor_commit_age_seconds`, and the new
`det_coverage_1to2h` gauge). DEMO.md §3 below does this; I'd add one clause to
the dashboard footer: *"committed within 5 minutes of scoring — see coverage
below"* rather than touch the core sentence.

## 3. "Zero-billing compute … no card, no top-up, no payment rail"

**Where:** spec §0.1 property 1, README.md:158-160.

This is now **two different things** depending on who's running it:
- **The agent's own account** is funded by CREDIT the operator activates into
  it (see #5 below) — that's a top-up, by a human, even though it's on-chain.
- **A holder cloning the repo** still needs no card — they authorize with
  their own wallet and their own accrued/purchased CREDIT.

**Proposed for spec §0.1 property 1:** unchanged — it describes fork-and-run
capability, which is still true (no Orbio account, browser or card needed to
*run* the software).
**Proposed for README.md:158-160 (fork-and-run section):** add one clause —
*"with no card, no top-up **from a fiat rail**, no payment rail"* — since the
top-up here is CREDIT, on-chain, not a card. And add a line noting the shipped
instance's own funding is disclosed under Metabolism → Funding on the
dashboard.

## 4. Property 2: "throughput follows token activity and holdings"

**Where:** spec §0.1 property 2, field report draft §10 ("sizes its daily
research budget from credits accrued in the last 24 hours").

**Not yet true of the shipped instance.** `dailyDeepdiveBudget()` (the
accrual-derived budget) is still dead code (Codex's #1 finding, confirmed).
What's shipped: the agent's balance and lifetime spend are read live from its
own Orbio account (`GET /key`, on-chain-verifiable activations), and the $5/day
cap is a fixed config value, not yet a function of accrual.

**Proposed:** rewrite property 2 as two sentences —
> *Credit-funded compute: the daily deep-dive budget is spent from CREDIT
> activated into the agent's own on-chain account; every activation — who
> funded it and how much — is a public transaction (Funding, on the
> dashboard). Sizing the daily cap itself from trailing accrual, rather than a
> fixed number, is built but not yet wired in (see DECISIONS.md).*

This is the biggest substantive change in this pass — it turns an unbuilt
claim into a true, narrower one, and it's the one I'd most want your explicit
sign-off on since it changes what property 2 promises.

## 5. "The agent never holds or converts money to make this happen"

**Where:** spec §0.1 property 2, dashboard P&L note (already changed in code —
this line is now gone from the shipped copy), field report §07.

**Proposed:** drop this sentence everywhere it remains (field report only —
already removed from the dashboard and not present in the property-2 rewrite
above). It's not false, but it's not the interesting property either once #4
above is rewritten narrower.

## 6. "Authorize once … the ONLY interactive step, ever"

**Where:** README.md:173 (`pnpm orbio:auth`), spec §8.1.

**Now true in the strongest sense, for the shipped instance.** The agent's key
is its own wallet's signature — there is no browser step, no session, nothing
that expires. `pnpm orbio:auth` (browser OAuth) is the *legacy* path, still in
the repo for the MCP-only fallback (`METABOLISM_SOURCE=mcp`), not what
production runs.

**Proposed:** README.md fork-and-run steps — replace step 2 (`pnpm orbio:auth`)
with:
> *2. Set `ORBIO_KEY_SOURCE=wallet` and point `GAS_WALLET_PRIVATE_KEY` at a
> wallet you control — no browser, no session, ever. (The original
> `pnpm orbio:auth` OAuth flow still works as a fallback:
> `METABOLISM_SOURCE=mcp`.)*

## 7. "Days since human touch" / unattended continuity

**Where:** spec §0.1 property 3, field report §04 ("unattended for N hours").

**Now genuinely unbounded**, not "~1h" as of last week. The wallet-signed key
never expires; the only human action is funding (an on-chain activation, not a
sign-in).

**Proposed:** property 3 →
> *Unattended continuity: the key is a standing wallet signature, not a
> session — nothing expires. The signed lifecycle log shows every state
> change; the only human action possible is funding the account (§ above),
> and every such action is a public transaction, not a credential grant.*

## 8. SELL_IMPAIRED — keep as descriptive-only

**Where:** dashboard badge (already correct), field report §"why one row is
flagged".

**No change proposed.** Still ~91% positive against thin liquidity; still
correctly excluded from claims. Mention explicitly in DEMO.md (below) so a
judge doesn't have to find it.

## 9. det_v0 calibration — do not overclaim while it's unfixed

**Where:** nowhere current copy claims calibration quality directly, but
nothing warns against reading Brier Skill wrong either.

**Proposed addition** to the benchmark panel's sub-header (`index.html`, one
line): *"'beats X' means statistically distinguishable ranking (DeLong test),
not that the probability itself is well-calibrated — Brier Skill is shown
separately for that."* This is a clarification, not a retraction — nothing
currently claims calibration, but a judge could misread "beats base_rate" as
"is accurate," and the two cells that clear the bar (LIQ_IMPAIRED@24h,
TRADING_ALIVE@24h) both have negative Brier Skill.

## 10. "The product is the track record"

**Where:** field report §01, §10 (200-word draft).

**Leave as-is.** It's a framing claim, not a factual one, and it's consistent
with what's shipped: nine of eleven cells are live, several are still thin.
DEMO.md states the actual coverage next to it so the claim isn't read in a
vacuum.

---

## Net effect if all of the above are approved

- Two sentences become **true where they were previously false or unbuilt**
  (#6 continuity, #7 unattended).
- One property is **narrowed to what's actually shipped** (#4), with the
  unbuilt part named and pointed at DECISIONS.md instead of silently implied.
- Everything else is a **count correction** (#1) or an **added caveat**, not a
  retraction.

Reply with a yes/no per numbered item (or "all yes") and I'll apply them.
