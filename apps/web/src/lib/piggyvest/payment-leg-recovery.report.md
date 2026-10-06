# Payment-leg durable recovery — READY FOR PARENT REVIEW

## Scope and authority

Implements the bounded payment-leg assignment at the top of `docs/piggyvest-final-gap-audit.md`, grounded in original product rules lines 57, 59, 61, 82, 84 and 86. Metadata completion is not financial completion.

- Existing immutable purchase intent and canonical ledger reservation remain the only economic identities. Logical references are `(operationId, savings|other)` local tuples, never provider idempotency keys.
- Amounts and principal/paid-interest allocation come from the existing intent. No caller amounts, provider references/statuses, raw payloads, actor authority, success, refund or release command are admitted.
- Append-only observations accept only reported unresolved reasons. Exact observation-ID replay is idempotent; conflicting/global IDs and cross-scope lookup are denied. Zero other-payment means `not_required` and cannot receive an observation.
- The existing 171 scoped locks/current reservation proof are reused. Historical amounts remain unchanged after reversal/resolution; current proof becomes reconciliation-required rather than falsely retained. New reasons never authorize retry or compensation.
- Adapter defaults disabled. SQL grants remain absent; local Unix-socket database/role restrictions are inherited from 171. HTTP integration adds only opt-in GET status metadata, with existing authentication, scoped RLS, bounds/redaction and no-store behavior. No observe HTTP endpoint.

## Files

- `supabase/migrations/20260912183000_payment_leg_recovery.sql` — sole new migration, frozen SHA-256 `3f62ace9a4fd9734ae3295cca3914a0a0a944b1051938b3fed6571555814668d`.
- New `apps/web/src/lib/piggyvest/payment-leg-recovery.ts`, `payment-leg-recovery-statements.ts`, fixture and colocated tests; `payment-leg-recovery-runtime.integration.test.ts`.
- New `apps/web/src/schemas/payment-leg-recovery.ts` and colocated test.
- New `packages/shared/src/contracts/piggyvest-payment-leg-recovery.ts` and colocated test; optional `paymentLegRecovery` on existing `piggyvest-purchase.ts` status, with matching tests. No new package export surface.
- Narrow `customer-purchase-handler.ts` optional `{paymentLegRecovery:{enabled:true}}` readback; `purchase-current-recovery-handler.test.ts` regressions. Absent option retains exact previous status behavior; enabled failure does not fall back.
- New `tools/test/payment-leg-recovery-local.sh`, `payment-leg-recovery-setup.sql`, `payment-leg-recovery-cases.sql`.
- Owned `apps/web/src/schemas/protected-offer.test.ts` formatting repaired and its two tests rerun.

## Evidence

- Schema RED (missing new module): `/tmp/payment-leg-schema-red.log`; initial GREEN 10 tests.
- Exact optional-handler RED 1 failed/1 passed: `/tmp/payment-leg-handler-red.log`; unchanged regression GREEN 2 passed: `/tmp/payment-leg-handler-green.log`.
- Final web scoped 7 files / 22 tests passed: `/tmp/payment-leg-final-unit.log`.
- Shared strict metadata + purchase contract 2 files / 27 tests passed: `/tmp/payment-leg-shared-green.log`.
- Scoped Biome 16 owned files clean; web and shared TypeScript exit zero: `/tmp/payment-leg-web-types-final.log`, `/tmp/payment-leg-shared-types.log`.
- Runnable actual database command from worktree root: `bash tools/test/payment-leg-recovery-local.sh`.
- Final actual command exit zero: `/tmp/payment-leg-pg-final.log`. Direct SQL checks are distinct from standard-executor evidence. Actual registered executor plus HTTP suite: 6 passed before restart, 6 passed after restart. Includes committed response-loss replay, simultaneous duplicate/conflicting observations, canonical history/current proof, default/foreign-role denial, authenticated scoped status and optional-feature compatibility, actual HTTP no-cookie 401. Final ledger operation/posting counts equal the pre-observation baseline.
- Earlier harness failures were fixture-only: immutable quote UPDATE replaced by a separate explicit synthetic quote INSERT; missing synthetic RLS role supplied via existing pricing setup; unauthenticated factory throw (503) replaced by the established typed null-user/AuthError fixture to test 401. Assertions were not weakened. Own disposable clusters stopped/removed by exit traps; no held server remains from this run.
- Hooke source review reported no actionable P1/P2; independently ran 9 tests before final expanded coverage. Final successful logs/hash forwarded. Russell already registered the two exact statements and owns manifest registration; Fermat owns the additive runtime service propagation.

## Remaining boundaries

Actual HTTP tests use explicit synthetic authentication and disposable local PostgreSQL, not installed-session or provider validation. No provider call, deployment, existing migration edit, order write, ledger write or financial settlement was added. Provider-supported leg sequence, finality, reference/idempotency semantics, fee payer, retry and compensation destination remain contract blockers. Fulfilment stays disabled. Full candidate/schema replay and final acceptance remain parent-owned.
