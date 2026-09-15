You are building the project described in launch-auditor-spec-v0.2.md. Read it before every task.
Rules:
- TypeScript, Node 22, pnpm. Postgres via Prisma. Redis via BullMQ. Fastify for HTTP. viem for chain access.
- OpenRouter: use @openrouter/agent (tool() + zod + callModel) for the deep-dive agent loop and @openrouter/sdk for plain calls. Always send the attribution headers HTTP-Referer=<dashboard URL> and X-Title=<project name>. Pin exact model slugs in config for anything that is scored; never use ~latest aliases or openrouter/auto for a scored forecaster.
- Record cost per call from the response usage field and the GET /api/v1/generation?id= endpoint into the compute ledger.
- One milestone at a time. Do not start the next milestone's files.
- Every milestone ends with: tests passing (vitest), a README section, and a single command I can run to verify.
- Never hardcode addresses, keys or RPC URLs; use .env with .env.example updated.
- Never call paid APIs in tests; use recorded fixtures.
- When you are unsure of a contract address or ABI on Robinhood Chain, fetch it from Blockscout and show me the evidence before using it.
- Keep a CHANGELOG.md; append what changed and what I should verify.
- If a task will take more than ~200 lines, propose a split first.

---

Notes for this repo (not part of the original block):
- Node 24 is installed locally; `engines` is `>=22`. All deps are compatible.
- `pnpm verify` is the single verify command. It runs offline (prisma generate + validate + typecheck + vitest). It does NOT need Docker or network.
- `docker compose up -d && pnpm db:migrate` is the DB step; it needs Docker Desktop and is run by the human, not in `pnpm verify`.
- The spec lives at ./launch-auditor-spec-v0.2.md in this repo.
