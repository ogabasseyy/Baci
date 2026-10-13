# PiggyVest savings integration — completion matrix (18 Sep 2026)

Ownership: this branch (`feat/piggyvest-wallet`, worktree `0d77/Baci-app`).
"Done" means evidenced below. Fixtures in tests are synthetic; no real
funds, customer data, production changes, merges or external messages.

## 1. Genuine provider delivery

| Item | State | Evidence |
| --- | --- | --- |
| Signed intake accepts + durably records | Done (staging receiver) | Durable-receipt handoff: receipt `af206dba-…`, replay dedupe, invalid-sig 200 |
| Test funding settles | Done (slow, then fast) | 17 Sep diversions unsettled for 100+ min; 18 Sep round settled same-day. 18:12 UTC round (owner-verified): second 10,000-kobo credit landed, wallet at 20,000 kobo, two successful credits listed provider-side |
| Provider-origin event correlated | Done (two events) | Genuine `bank-transfer.inflow.success` observed 18 Sep 17:57:47 UTC (matching 200 POSTs in deploy log) and 18:12:45 UTC (owner-verified receipt, reporting 20,000-kobo balance). Schemas corrected to the observed shape (samples would have quarantined both) |

## 2. Secure financial processing

| Item | State | Evidence |
| --- | --- | --- |
| Raw-bytes auth before decode; invalid-sig 200 | Done | Route + route-bytes tests (this branch) |
| Durable inbox (event_id collapse) | Done, local tests | 179-test scope green; SQL regressions run on isolated DB (ROLLBACK) per handoff |
| Lease claim / fenced completion / retryable-vs-poison | Done, local tests | Leases migration + processor tests |
| Quarantine for unparseable/unknown/conflict + 200-after-receipt | Done, local tests (this turn) | Quarantine migration + regression test verified on local PostgreSQL 18 Sep |
| Redacted replay details in inbox (additive column) | Done, local tests (this turn) | ALTER verified on local PostgreSQL; PII-absence tests |
| Mapping proof before credit (inflow + interest) | Done, local tests (this turn) | UNMAPPED retryable; mismatch tests |
| Same-id/different-content conflict | Done, local tests (this turn) | First-writer-wins + quarantine |
| Worker entry point replaying pending/quarantined rows | NOT STARTED | Needs reviewed worker boundary + provisioning intent tracking |
| Protected migration corrections (inbox/outbox quoted numerics) | Done (owner-approved 18 Sep) | 3 quoted names corrected; full 10-migration chain applies on local PostgreSQL; 7/7 SQL regression tests pass (leases failure was a scratch-env missing BYPASSRLS, confirmed environmental) |

## 3. Staging app connection

| Item | State | Evidence |
| --- | --- | --- |
| Webhook receiver deployed + signed 200 | Done | Durable-receipt handoff |
| Auth gateway health | Done | `/auth/v1/health` 200 after promotion (handoff) |
| Installed-gateway private smoke (owner sudo) | BLOCKED | Gate 1 of connection handoff; sudo unavailable noninteractively |
| Isolated backend deploy with full app routes | BLOCKED | Public staging is webhook-only (`/api/storefront/...` 404); needs deploy approval |
| Synthetic login / session / tenant isolation via UI | BLOCKED | Needs the above |
| Mobile live-service flip | NOT STARTED (intentionally) | Fixture default kept until isolated endpoints verified |

## 4. Complete savings journey

| Item | State | Evidence |
| --- | --- | --- |
| Pure policy (activation/readiness/maturity) | Done (prior) | savings-policy suites green |
| Exact variant picker persisted to checkout | GAP (audited) | Not started |
| Server-side price snapshots + eligibility | Partial | Snapshot reads exist; quote/version flow not started |
| Provisioning activation | BLOCKED on worker boundary | POST intentionally 503; provisioning lib retained for worker |
| Cancel-plan/refund op (distinct from pause-debits) | NOT STARTED | Product-rules map: cancel-plan.ts |
| Plan-wallet-to-checkout bridge (no double spend) | NOT STARTED | Needs operation reservation (plan-operation.ts) |
| Interest payout recognition | Done, local tests | Interest ledger + mapping gate |

## Test/verification log (this turn)

- `pnpm vitest run` over piggyvest libs/schemas/routes, wallet routes, payment-account concurrency, env: 43 files, 451 tests, all pass.
- `tsc --noEmit`: clean. `biome check` on touched areas: clean.
- Local PostgreSQL (scratch cluster, since stopped): all 10 piggyvest migrations apply in order; 7/7 SQL regression tests pass. Bonus find verified + fixed: the new `event_details` column needed an additive service-role INSERT grant (column grants still bind service_role), and the quarantine table now carries least-privilege service-role grants (no DELETE/TRUNCATE).
- Reconcile probe (read-only, subagent, /tmp script only): STILL-UNSETTLED. Webhook GET 200 (their receiver shape); app paths 404 as known. Probe correction adopted: local `.env.local` provisions the secret as `PIGGYVEST_SECRET_KEY`, which app getters did not read — getters now accept both names (PVB preferred), with tests.
- Scheduled recheck 18 Sep 18:53 UTC: main wallet balance 10,000 kobo (17:53 funding SETTLED); unfiltered tx list still 0; 6 webhook POSTs 200 in prior 2h per deploy log. Verdict: SETTLED on balance evidence; tx-list evidence absent.
- CodeRabbit (`review --agent -t uncommitted`, tracked files only): 4 findings, all fixed+tested — misleading duplicate-test name (renamed); PIGGYVEST_API_BASE_URL now https-enforced at schema and getter (fail closed, with tests); synthetic-KYC guard now also refuses NODE_ENV=production (with test); DVA reactivation race fixed with inactive-guard + loser-convergence (with parallel-account test). Untracked new files were NOT covered by that review.
- Replay rehearsal 18 Sep ~20:30 UTC (isolated scratch PG `rehearse` via pgrst-rehearse + loopback gateway shim; synthetic receipts only): entrypoint `replay-run.ts` drove 3 seeded receipts end to end — 2 genuine inflow → processed with 2 ledger credits, 1 poison → quarantined `undecryptable` (digest-collapsed, no plaintext). Two real bugs found and fixed: (1) claim RPC never reaped expired `processing` leases, so one crashed worker wedged receipts below the dead-letter ceiling — fixed in `replay-storage.sql` + new lease-reap regression block in `replay-storage.test.sql`; (2) `replay-run.ts` flag parser stepped argv by 1 — fixed. Rehearsal infra note: supabase-js appends `/rest/v1`, so the runner needs a gateway-style origin (shim used only for rehearsal); rehearsal PostgREST logs in as `rehearsal_login`, which needed membership in the staging roles (scratch-only GRANTs). Race check: 2 fresh receipts + 2 concurrent passes → exactly-once (4 credits total, both exits 0, no resolution failures). Gates: SQL suite green on clean `verify` DB (rollback-wrapped), 37 replay vitest green, `tsc --noEmit` clean, `biome check` clean on touched files.
- Live staging recheck 18 Sep ~20:40 UTC (read-only GETs, exact `/api/v1` paths from repo client; secret never printed): NO CONFLICT — earlier "empty" was my wrong path/shape. Main wallet `01M238…` active, balance 10,000; probe wallet `01M2T3…` ("BACI STAGING PROBE MU6V4RY4", child of main) active, balance 20,000. Tx list 200 with 3 `successful` edges: 2×10,000 to the probe wallet + 1×10,000 to main. Balances reconcile exactly (2×10,000=20,000; 1×10,000=10,000). Probe wallet carries `api_customer_id 01M2T3PAHG3P5A32REX8MH3HD7` — the Baci-side mapping row for it is still ours to create.
- Staging deployment to local supabase stack DB (additive only, production untouched): all 11 `*piggyvest*` migrations applied and recorded in `schema_migrations`. BLOCKED at intake storage: its audit guard refuses shared-platform DBs (`extensions.pg_stat_statements_info` still PUBLIC-readable; also requires `authenticator` NOINHERIT cluster-wide). Intake apply rolled back cleanly — no partial state, no pvb roles/tables created. Awaiting owner decision on hardening vs dedicated staging DB before mapping row + live replay.
- Staging deployment REDIRECTED to dedicated `pvb_staging` DB (owner-approved; shared DB proven unsuitable — 136 platform SECURITY DEFINER fns are PUBLIC-executable, so the guard can never pass there; my one shared revoke was reverted). Fresh DB: 11 piggyvest migrations applied+recorded, intake + replay storage installed clean (audit passes on bare DB). One logged deviation: 160000 applied staging-adapted (customer Auth policies omitted — `public.customers` baseline absent; revokes/RLS/grants intact). Staging-only service_role grants: SELECT on plan_wallets, SELECT+INSERT on inflow/interest ledgers and plan_wallets. Dedicated `pgrst-staging` PostgREST (v12.2.0, own login role + JWT secret, port 3005 via VM-side forward) + loopback `/rest/v1` adapter on 3006. PostgREST URL requirement RESOLVED: supabase-js appends `/rest/v1`, so the deployment origin must be a gateway (Kong `/rest/v1` route to pgrst-staging is the owner follow-up); the adapter documents and tests exactly that mapping.
- Baci mapping created (our responsibility): probe wallet `01M2T3…` → `piggyvest_customer_id 01M2T3PAHG3P5A32REX8MH3HD7`, synthetic Baci customer/merchant UUIDs, status ready.
- LIVE STAGING REPLAY 18 Sep ~21:05 UTC: 2 receipts sealed from verified provider tx facts (PVB01M2TVH…/PVB01M2TTN…, 10,000 kobo each, probe wallet) → run 1 claimed:2 processed:2; ledger carries the exact provider tx ids/amounts/wallet (receipt→tx→ledger reconciled at fact level). Run 2: claimed:0 processed:0, ledger still 2 rows — ZERO additional credit proven. Honest boundary: envelopes are staging-sealed from tx-list facts (genuine webhook bytes live only in the deployed service — owner step); staging receipt key is ephemeral in `/tmp/pvb-staging-env` (owner must provision for any real deployment).
- REDACTED EXPORT reconciliation 18 Sep ~21:25 UTC (`/private/tmp/piggyvest-muse-redacted-receipts-2026-09-18.json`): 17/17 checks PASS — both inflow tx refs/amounts/wallets match independently verified provider facts, balance progression 10000→20000, decrypt+digest verified upstream, no bank details/IPs in export. KEY CORRECTION: genuine provider customer_id is `c096507d-dc32-45d2-9c01-871a27abfd10` (not the wallet `api_customer_id` first used) — staging mapping row corrected to it. Functional classification: verification receipt (no eventType) → quarantine, no credit; redacted inflows fail schema ONLY on redacted narration/IP → quarantine, no credit; full-shape equivalents with genuine eventIds validate true.
- CORRECTED live-path run on local `pvb_staging` (rehearsal-only, never merges): genuine-shaped receipts (real eventIds/tx refs/customer/wallet) → claimed:2 processed:2, ledger rows carry genuine eventIds + `c096507d` customer + 10,000 kobo; rerun claimed:0, ledger still 2 — zero additional credit re-proven.
- RUNNER HARDENED (their flag, fixed): `replay-run.ts` no longer accepts arbitrary https — origins must be loopback or exactly listed in new `PVB_STAGING_ALLOWED_ORIGINS` (absent = loopback-only; origin-compared, credentials/scheme/case-smuggling refused). New `replay-run.test.ts` 5/5 green; refusal proven live against `https://staging.example.com`. Biome/tsc clean; 42 replay tests green. Full suite NOT rerun per instruction.
- ISOLATION PROOF (allowlist critique answered) 18 Sep ~21:35 UTC: runner now pins database identity — new `piggyvest_staging_system_id()` RPC (read-only, worker-executable, covered by SQL regression test) plus `PVB_STAGING_EXPECTED_SYSTEM_ID` gate that runs BEFORE any claim. A correct URL aimed at the wrong database refuses. Live-proven on staging: correct pin → pass completes; wrong pin → `staging-pass-failed` with identity mismatch, zero claims. Origin allowlist (`PVB_STAGING_ALLOWED_ORIGINS`, absent = loopback-only) remains as the first gate. `replay-run.test.ts` now 7/7 (origin + identity); biome/tsc clean.
- Standing owner-side items (VPS provisioner access required; exact handoff below): (1) verify corrected mapping in the actual isolated staging DB — `SELECT wallet_id, piggyvest_customer_id, status FROM piggyvest_plan_wallets WHERE wallet_id = '01M2T3PCEDE2MGF2S7Y5T49H01'` must show `c096507d-dc32-45d2-9c01-871a27abfd10` / ready (rehearsal copy verified corrected; actual DB unreachable from here by design); (2) gateway `/rest/v1` route to the staging PostgREST plus restricted worker JWTs (roles `pvb_staging_worker`/`pvb_staging_ingest`, service_role for app reads) and receipt-key provisioning; (3) live VPS replay of the two original encrypted inflow receipts through the restricted worker — expect 20,000 kobo total recognised, then rerun proving zero additional credit. Verification receipt `af206dba…` must stay quarantined with no ledger write (worker routes it there by construction).
- DRAFTS STAGING TAKEOVER 20 Sep ~12:25–12:50 UTC. Public evidence rechecked (auth 401 / products 200 / webhooks 200 / drafts 404 — matches baseline; gateway lease valid to 21 Sep 11:24 UTC). VPS build present with fresh standalone server.js; source manifest verified byte-exact (`653219f3…`, 21240 files). Standalone assets prepared + verified. Private server RUNNING on 127.0.0.1:4792 with reviewed staging env. No-beacon finding: `customer-savings-draft-beacon` exists nowhere (worktree, build, approved snapshot) — recipe step not executable, not invented. Unauthenticated catalogue/list → 401 as expected. Authenticated tests PARTIAL: gate now OPENS (500 from inside handler vs 403 SAVINGS_DRAFT_DISABLED before the loopback fix — the fix is working), but handler crashes: `SUPABASE_SERVICE_ROLE_KEY is not defined`. Fresh synthetic session minted (mine, valid ~13:06 UTC; original preserved). Other-stack `runtime-secrets.json` inspected by key names only — isolated-savings DB passwords, out of scope, untouched. Nginx exact-path block RENDERED + checksummed (`b2f842dd…`, 41 lines) — root-protected file not touched. No Vercel artifact dir exists locally or on VPS (Terra/owner lane).
- OWNER ACTION NEEDED (blocking): staging `SUPABASE_SERVICE_ROLE_KEY` for the private 4792 run (and any deployment) — no approved source holds it. Everything downstream waits on this one value: authenticated catalogue/list/variant/draft/idempotency/policy/persistence/cross-merchant tests, Nginx install, prebuilt deploy, public verification, phone readiness.
