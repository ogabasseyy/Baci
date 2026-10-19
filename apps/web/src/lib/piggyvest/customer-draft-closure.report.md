# Unfunded draft closure — local review evidence

**READY FOR PARENT REVIEW — bounded local closure.**

## Implemented boundary

`createPiggyvestCustomerDraftClosureHandler(common)` exposes GET/POST through Fermat's actual optional `/close-plan` composition service. Authenticated RLS context, fixed goal, CSRF, bounded body, current actor/scope revalidation and no-store responses reuse `customer-operation-handler`. Public schemas reuse the shared closure contract. UUID identity comparisons are case-insensitive; the original validated command remains unchanged for exact idempotent replay.

The private SQL read/close functions share the existing registry → ledger binding → policy/customer → goal locks. Only a paused/manual draft with zero legacy amounts and no ledger operation, contribution, activation, reservation intent, schedule state, mapping, provisioning intent or collection correlation can close. Current policy revision and enabled terms must match explicit acceptance. Closure inserts an immutable receipt and marks the public goal cancelled; it does not issue a refund, forfeit interest, delete a wallet or write ledger postings.

Mapped or provider-exposed goals return `requires_reconciliation / provider_zero_unverified`, never a terminal claim. Closed receipts are historical operation evidence, not current zero-balance proof. Canonical late credits and their validated reversals remain possible; new reservations, provisioning and reactivation remain denied. Existing mappings are never changed.

## Frozen SQL

- `supabase/migrations/20260912181000_draft_closure.sql`: `2a0976ab77b7f593452db7268ef1b35522f5fd83455b4c1d0023d24c9f72b113`.
- `supabase/migrations/20260912181100_draft_closure_terminal_guards.sql`: `e3ebceb5b6b5beb69bc9a6fb9a844d9aaed6701f029aa6876b2c405349f5d58d`.

Hooke independently reviewed these exact hashes and closed both P2 findings. No remaining confirmed P1/P2 was reported within this bounded closure scope. Both files are frozen; further corrections require append-only migrations. No production grants or default service activation are introduced.

## Regressions and connected evidence

- Missing schema RED, then strict projection tests GREEN.
- Actual terminal reactivation RED: `/tmp/piggy-closure-terminal-red.log`; terminal guard GREEN.
- Canonical late-credit reversal RED: `/tmp/piggy-closure-reversal-red.log`; unchanged canonical reference validation now admitted, reservations still denied.
- Alphabetic uppercase UUID handler RED403; canonical selection/raw-command separation GREEN, including actual HTTP uppercase GET/POST, exact replay and restart.
- Scoped handler/schema/statements: **17 tests passed**. Final exact migration registry: **60 passed**. Final exact planner/hash/lookalike regressions: **31 passed** after missing-prefix/hash checks failed first (181 batch, then seven frozen 180 files). Scoped Biome: **13 files clean**. Root types/checks remain parent-owned; no root pass is claimed here.
- `bash tools/test/draft-closure-local.test.sh`: actual restricted standard executor, actual HTTP listener and disposable PostgreSQL; **4 before restart + 1 after restart** (complementary phase cases intentionally skipped). Two actual blocked PostgreSQL races cover provisioning-before-closure and closure-before-provisioning.
- Latest joint run `/tmp/piggy-closure-joint-final.log`, exit 0: actual device publish/confirm replaces unexposed draft; stale original closure revision rejects, current revision closes. Closed replacement cannot activate. Separately, a replacement with synthetic internal principal activates through the NEW device activation path and cannot close. Assertions distinguish current activation view from the original activation table.
- Joint run cleaned only owned `/tmp/baci-piggyvest-full.ONBCz7` and `/tmp/baci-piggyvest-runtime.bL1hY0`. Existing browser holds were not stopped or reset.
- Final **frozen and registered** candidate run: `/tmp/piggy-closure-frozen-ui.log`, exit 0. All joint SQL assertions passed, followed by **4 actual HTTP/PG tests + 1 rendered UI/shared-client/HTTP/PG test + 1 post-restart test**. Leibniz's UI test loses the actual committed POST acknowledgement, recovers through GET, and verifies no second POST. The runner uses the exact registry preflight and copied/hash-verified migration bytes, without direct migration fallback.
- Final owned directories `/tmp/baci-piggyvest-full.OJYgDr` and `/tmp/baci-piggyvest-runtime.MomJCw` were stopped/removed and independently checked absent. Frozen 181 hashes were rechecked unchanged. Parent was notified that guarded full-schema replay is unblocked; registry/planner ownership returned to parent.
- Subsequent expanded UI run by Leibniz: `/tmp/piggy-closure-ui-final2.log`, reported exit 0; this task independently inspected **4 HTTP + 2 UI + 1 restart passes** and verified owned directories `/tmp/baci-piggyvest-full.VbbGUk` and `/tmp/baci-piggyvest-runtime.B7qf4q` absent. The expanded UI cases additionally assert one durable closure receipt and zero ledger operations, and mapped-wallet read with no POST. A preceding expanded-test attempt failed because a new test was accidentally nested; Leibniz corrected test placement and reran. That failed attempt is not presented as passing runtime evidence. No SQL or runtime changes accompanied this expansion.

## Exact owned paths

- `apps/web/src/lib/piggyvest/customer-draft-closure-handler.ts` and `.test.ts`.
- `apps/web/src/lib/piggyvest/draft-closure-statements.ts` and `.test.ts`.
- `apps/web/src/lib/piggyvest/customer-draft-closure-local.test.ts` and `customer-draft-closure-local.test-fixture.ts`.
- `apps/web/src/schemas/piggyvest-customer-draft-closure.ts` and `.test.ts`.
- The two frozen migrations above.
- `tools/test/draft-closure-local.test.sh`, `draft-closure-fixture.sql`, `draft-closure.test.sql`, `draft-closure-device.test.sql`.
- Authorized registry edits: `apps/web/tools/db/supabase-history-replay-savings-pending-sources.ts`, its `.test.ts`, `expected-savings-pending-sources.test-support.ts`, and `tools/test/piggyvest-full-local-plan.mjs` with its `.test.mjs`.

## Remaining handoff dependencies

The earlier joint log used unfrozen 180 candidate files; the final log supersedes that limitation with all seven Fermat-reviewed/frozen files registered at their independently verified hashes. Leibniz's `apps/web/src/lib/piggyvest/draft-closure-journey.http.integration.test.tsx` is now invoked by the runner and passed; its source remains Leibniz-owned. Screen-owner/native installed-session acceptance, parent full-schema replay and root gates remain separate. This is not full-product, provider-sandbox or live acceptance. Mapped-wallet zero/no-inflight reconciliation remains an operation-specific provider contract blocker; no fabricated provider-zero flag is introduced. No provider API, credentials, external mutation, customer data or production money was used.
