# Reconciliation operational readback

READY FOR PARENT REVIEW. 185 SQL is frozen after Hooke bounded source review (no P1/P2) and actual local PostgreSQL/HTTP tests. This is operational visibility over existing durable 172 records, not financial reconciliation completion.

## Exact API

`reconciliation-cases-handler.ts#createReconciliationCasesHandler(common).GET(NextRequest)` uses the existing getUser-first authenticated context and restricted executor.

Optional isolated runtime `services.reconciliation: { enabled: true }` enables `GET /reconciliation`; absent configuration returns 503. POST is 405; no mutation or alert-dispatch handler exists.

- Single query: `{goalId, collectionOperationId}`. Identifiers normalize UUID case before scope comparison.
- List query: `{goalId, after?}`. A cursor must belong to the same original/current actor and scoped goal; pages are ordered by canonical correlation UUID, maximum 50, with `nextCursor` or null. No global count or foreign cursor is returned.
- Common response: `goalId, financialEffects:'UNKNOWN', fundsUse:'not_authorized', dispatch:'disabled'`.
- Single response: `status:'absent'|'unresolved', caseId`. Absence is not a safe-retry or settlement claim.
- Unresolved fields: source pending/unknown status, immutable observation count, redacted alert `{code:'financial_evidence_unresolved',severity:'review_required',delivery:'not_dispatched'}`, optional canonical credit `{operationId,recordedPrincipalKobo,evidence:'internal_ledger_only'}`, and current canonical ledger `{confirmedPrincipalKobo,reservedPrincipalKobo,pendingInterestKobo,fundingReversed}`.
- List response adds `cases` and `nextCursor`; each case is the same scoped unresolved projection.

No raw provider identifiers, evidence references, wallet/account details, payloads, secret configuration or original actor identifiers enter the projection. Internal canonical operation IDs and ledger amounts are returned only after current and original actor/tenant/goal checks. The canonical historical credit remains separate from current ledger/reversal state; pending interest is never reclassified.

## Files

New migration `supabase/migrations/20260912185000_reconciliation_cases_read.sql`:
`5b078d9c73c9911533d7b6cbdec5eadbe7479408cb540bccbc1fdec82e847b15`.

It adds only a private schema and two restricted read functions. No tables, duplicate case/observation storage, grants, ledger changes, synthetic financial status, cash delta or resolution API. Existing 172 identities and durable observations are reused directly.

New runtime/tests under `apps/web/src/lib/piggyvest/`:
`reconciliation-cases-handler.ts`, `.test.ts`; `reconciliation-cases-statements.ts`, `.test.ts`; `reconciliation-cases.runtime.test.ts`; this report.

New schema/tests: `apps/web/src/schemas/reconciliation-cases.ts`, `.test.ts`.

New harness files under `tools/test/`: `reconciliation-cases-local.sh`, `reconciliation-cases.test.sql`, `reconciliation-cases-boundaries.test.sql`, `reconciliation-cases-reversal.test.sql`, `reconciliation-cases-typecheck.json`.

Authorized narrow composition additions: `runtime-composition-routes.ts`, `.types.ts`, `.constants.ts`, `runtime-composition-routes.test.ts`, `runtime-composition.constants.test.ts`. Parent also authorized explicit nested `services.purchase.paymentLegRecovery` forwarding only on purchase status, covered by new `runtime-composition-payment-leg.test.ts`; quote/prepare remain unchanged. After coordination with Descartes and Leibniz, optional `services.periodRecovery:{enabled:true}` connects `GET /period-attribution` to the actual `createPiggyvestCustomerPeriodRecoveryHandler`. New `runtime-composition-period.test.ts` covers absent503, auth401/no SQL, wrong-goal403 and POST405. The 184 handler/SQL/actual-PG acceptance belongs to Leibniz, not this report.

## Tests and evidence

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

- `bash tools/test/reconciliation-cases-local.sh`: fresh socket-only PostgreSQL, existing canonical 172 fixtures, actual registered restricted executor and loopback HTTP. Pass before restart and after canonical reversal/pending-interest fixture plus restart. Synthetic getUser/query fixtures are not production Supabase authentication.
- SQL covers duplicate observation retaining one existing case, missing metadata, cross-actor/cursor denial, exact wrong-wallet rejection, changed current owner rejecting original history, 52-case bounded pagination, late credit after cancellation retaining full principal 150 with reservation 100, historical 50 credit after reversal/current principal 100, pending 15 kept separate, no case tables or public RPC grant.
- Actual HTTP covers scoped single/list data, redaction, no-store, POST denial, cross-goal rejection and unauthenticated no-SQL denial. Final log `/tmp/fermat-reconciliation-final.log`.
- RED before SQL: missing read entry failed `/tmp/fermat-reconciliation-cases-red.log`. Actual HTTP missing route failed 404 in `/tmp/fermat-reconciliation-http-red.log`, then passed unchanged scenario after opt-in routing. Payment-leg option propagation separately failed before forwarding and passed after.
- Final focused handler/statements/schema/router/payment-leg/period tests: 7 suites, 11 tests passed. Hooke independently reran handler/statements/schema: 3 suites, 6 passed; inspected owner PostgreSQL logs but did not independently rerun that harness.
- Final scoped Biome: 15 owned files clean. `pnpm exec tsc -p tools/test/reconciliation-cases-typecheck.json` passes after Descartes fixed the previously reported adjacent payment-leg type errors. No casts, suppressed tests or frozen SQL changes were used to bypass them. All new runtime files remain under 300 lines.
- Hooke's final bounded 183/184 composition review found no P1/P2: payment-leg option reaches status only; period route is opt-in GET-only and uses the exact read allowlist. Reviewer independently ran 7 tests across composition/period handler/schema plus the 2 constants tests. Final 185 HTTP/PG rerun against this composed router exited 0; no full financial acceptance follows.

## Remaining boundaries

Provider cash units, query completeness/timing, pending movements, fee payer, terminal status mapping and finality still block real monetary discrepancy computation or resolution. This projection neither compares provider cash nor declares that liabilities have reconciled. No external alert, automatic resolution, new spending authority, deployment, provider call, financial mutation or existing migration edit is introduced. Parent/Russell own catalog/manifest/full-schema registration and broad checks; scoped GREEN does not establish a full-suite or live pass.
