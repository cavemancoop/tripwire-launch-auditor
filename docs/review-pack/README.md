# Review pack

Material for an independent review of Launch Auditor. Snapshot of repo `main` @
`d61dc20`, assembled 2026-09-15. Copies of repo files are frozen at that commit; if a
copy and the repo-root original differ, the difference is itself worth noting.

Read `CLAIMS.md` first — it is the list the project should be tested against.

## Phase A files

| File | What it is | How current |
|---|---|---|
| `CLAIMS.md` | Every public claim, verbatim with source file and line, plus the explicit non-claims. | Current at `d61dc20`. `DEMO.md` does not exist yet, so none of its claims are in here. |
| `LIVE.md` | Dashboard, API, feed, contract and signer addresses; which endpoints are read-only; verification commands; how to check a commitment by hand. | Current at 2026-09-15. |
| `launch-auditor-spec-v0.2.md` | The design spec the build follows. | 2026-09-06. Parts are superseded by `DECISIONS.md` (e.g. the Orbio MCP tool names, `det_v0.1`, backfill scope, the staleness gate). Where they conflict, DECISIONS.md is the intended rule. |
| `DECISIONS.md` | Standing decisions that aren't obvious from the code, newest sections include the 2026-09-15 session push and commit-loop fix. | Current at `d61dc20`. |
| `CHANGELOG.md` | Append-only record per milestone: what changed, scope calls, what to verify. | Current at `d61dc20`. |
| `HANDOFF-2026-09-14.md` | Session handoff: production state, architecture decisions, three claim-level findings, verify commands (§7). | 2026-09-14. Superseded where `HANDOFF-2026-09-15.md` updates it. |
| `HANDOFF-2026-09-15.md` | Session handoff: deep-dives live in production, feed live, remaining work. | Written before the last 2026-09-15 session. Its §2 says the session push is "NOT BUILT"; it has since been built but **not run** (see DECISIONS.md / CHANGELOG.md, 2026-09-15). |
| `field-report-2026-09-11.md` | Narrative write-up for a non-specialist reader, including "What is not proven" (§04) and the draft 200-word submission summary (§10). Converted from the published HTML; the tracked `Launch Auditor Field Report.pdf` at repo root is an earlier, truncated print. | Numbers are as of 2026-09-11 and stale. §04's continuity paragraph predates the 2026-09-14 staleness-gate change. |

## Phase B files (added after Phase A completed)

| File | What it is |
|---|---|
| `CODEX-REVIEW-PHASE-A.md` | The Phase A independent review output, verbatim, with a one-paragraph builder's note at the top about the commit outage. |
| `PRIOR-CRITIQUE.md` | Two earlier external reviews, verbatim — Part 1, a red-team of the v0.1 spec (~2026-09-02); Part 2, a billing-architecture review (2026-09-12) — each followed by the builder's table of what changed in response. |
| `closer-plan-2026-09-14.md` | An external closing-week plan written in response to `HANDOFF-2026-09-14.md`. |
| `POST-SNAPSHOT-FIX-e3e82f9.diff` | The commit-outage fix made after Phase A (`git show e3e82f9`), including its DECISIONS.md and CHANGELOG.md entries. The code in this repo is still the Phase A snapshot and does **not** contain this fix. |

## Ground rules

- No secrets are in this pack or in the repo's tracked files. `.env` and the encrypted
  Orbio token store are gitignored and have never been committed.
- Read-only: no pushes, no writes to production, no `POST` to the project's write
  endpoints (listed in `LIVE.md`), and no calls to any Orbio endpoint.
