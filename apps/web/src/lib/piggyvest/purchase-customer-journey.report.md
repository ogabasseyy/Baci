# Purchase and device-change customer journey — local review

## Implemented

- Shared strict purchase DTO, bounded client and stable-operation controller; exact pickup selection, full price breakdown, explicit confirmation, no automatic retry, historical receipt separated from current internal-only recovery.
- Approved cancellation transport extraction to `packages/shared/src/lib/piggyvest-customer-client-request.ts`; fixed origin/path allowlist, total deadline, bounded response, real CSRF and cancellation behavior preserved.
- Optional cancellation view-guard chain reaches actual transport before/after deferred CSRF. Throwing subscribers are isolated/removed; purchase recovery cannot replace the known original command.
- Shared device-change contract extracted from the existing web schema with compatibility re-export. Shared client/controller and web confirmation/readback UI reuse existing server pricing, terms and executor; no new quote engine or financial authority.
- Web SavingsScreen optional purchase, device-change, schedule and draft-closure bindings. Reciprocal action guards read pure sibling busy snapshots, not guard-triggering sibling reads. Existing funding journey extracted unchanged to remain below 300 runtime lines.
- Customer money display preserves exact kobo including safe-integer boundaries; pending interest is excluded, unresolved remaining payment and disabled fulfilment remain explicit.

## Evidence

- Cancellation HTTP regression reproduced: `preparedCommands` was zero because the integration fixture supplied a static CSRF token after the runtime adopted signed session-bound CSRF. The test now bootstraps `/csrf`, forwards the exact returned cookie/token, and retains one-command/no-retry/recovery assertions. Focused GREEN logged in `/tmp/purchase-coverage-green.log`; original RED is in `/private/tmp/piggy-full-candidate-test.log` around line 30561.
- Missing fixture colocated tests now cover customer-purchase-http, purchase-pricing-runtime, purchase-current-recovery and purchase-journey-runtime. Tests check local-only configuration denial, exact terms SHA, allowlisted synthetic RLS access and isolated strict recovery evidence.
- `PIGGYVEST_RUN_PURCHASE_JOURNEY=1 bash tools/test/purchase-pricing-local.sh`: actual shared client/controller → authenticated HTTP → standard restricted executor → disposable PostgreSQL quote/prepare/status, one intent, disabled fulfilment. One connected test and five existing pricing tests passed (`/tmp/purchase-journey.log`).
- `bash tools/test/device-change-local.sh`: existing SQL/race checks and shared-client lost-acknowledgement HTTP scenario passed; restart recovery passed (`/tmp/device-change-shared-connected.log`). Exact replay, wallet/ledger invariants and new-device pricing assertions retained.
- Four focused web suites: 31 tests passed (`/tmp/purchase-device-ui.log`), including both real ready schedule/closure controllers, delayed close acknowledgement, one close dispatch, disabled sibling resume and accessible closed receipt/recovery.
- Direct web and shared TypeScript checks passed (`/tmp/purchase-device-tsc-final.log` and `/tmp/purchase-device-shared-tsc-final.log` empty). Scoped Biome: 45 files checked, no fixes/errors (`/tmp/purchase-device-biome.log`). Shared final focused suites: 62 tests across 12 files (`/tmp/purchase-device-shared-final.log`). Four fixture suites plus the real signed-CSRF HTTP regression: seven tests passed (`/tmp/purchase-coverage-green.log`).

## Browser acceptance and remaining boundaries

`PIGGYVEST_PURCHASE_BROWSER_HOLD=1 bash tools/test/purchase-pricing-local.sh` creates a fresh bounded ten-minute fixture at port 4184 using the parent-owned QA server, goal 243, and a one-shot preparation capability. It prepares exact duration consent before synthetic principal credit and activation; enables only a fixture-reviewed pickup fee policy. Missing/foreign/duplicate synthetic-session cookies are denied. The hold executes in Node, not JSDOM; UI tests remain JSDOM.

Parent verified the fresh 4184 browser fixture: 256GB/new, total ₦1,069, selected savings ₦970, unresolved remaining payment ₦99; preparation once; historical receipt; explicit status refresh observed retained reservation and ₦10 unreserved principal. Intentional reload exposed recovery only with no quote/prepare controls; another GET refresh observed the same retained reservation and ₦10. No duplicate submission or paid/fulfilled claim. This browser evidence is parent-observed, not inferred from unit tests.

Before cleanup, read-only queries against this exact disposable cluster verified one purchase intent and exactly two ledger operations: one credit_principal and one reserve_purchase. No settlement or release existed for goal 243. After parent completed browser QA, the owned hold worker/runner were intentionally terminated before the ten-minute timer; shell cleanup removed its disposable cluster and listener. This interrupted hold is not reported as a passing timed-hold test.

This is explicit synthetic authentication with actual restricted local persistence, not live customer authentication or provider evidence. No new migration, catalog, provider dispatch, settlement, paid order, fulfilment, withdrawal, deadline extension or forfeiture was added. Provider settlement contracts and deployment/real-auth approvals remain external blockers only for those operations.

Status: READY FOR PARENT REVIEW. Hooke's final bounded current-source review reported no additional actionable P1/P2; independent combined regression and device handler/schema checks passed. Parent reported fresh root lint/typecheck clean. Owned source is frozen for this review handoff; no frozen SQL changed. Whole-repository test acceptance remains parent-owned and is not claimed here.
