# Savings exit evidence and accounting lane — local handoff

Worktree: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
Preserved baseline: `/private/tmp/baci-exit-evidence-baseline.9XWtru`.
No shared composition, prefunded module, existing migration, credential file, proxy,
branch, commit, deployment, provider account, or real money was changed.

## Implemented boundary

- `createSavingsExitEvidence` accepts only raw signed webhook bytes plus signature,
  not a requested transfer or dispatch success. It verifies the existing SHA-512
  signature boundary, independently reads the single transaction, TSQ, and both
  wallets through an injected HTTP implementation, validates their identities,
  reference, amount, business, currency and statuses, and persists a normalized
  receipt. The transport reuses `requestPrefundedCardProviderJson`; no duplicate
  timeout/body reader remains. Receipt business/currency are taken from the parsed
  source wallet after both wallet identities, business and currency agree. Missing
  currency/business, wrong business, non-NGN currency or wrong wallet IDs defer.
  Only mocked HTTP was used. No provider response body or secret is logged.
- `createSavingsExitEvidenceStore({ integrationId, socketDirectory, port })` is a
  local-socket-only recorder using the separate `piggyvest_exit_evidence_writer`
  login. It admits only `record_evidence`, validates parameters, and acknowledges
  only after COMMIT. It does not use service-role credentials or the customer
  statement catalog. SQL additionally requires an independently provisioned scope
  registry, a nonprivileged login without membership, and `piggyvest_local`.
- SQL pins receipts to the persisted operation, exact provider wallet/goal/customer
  mapping and business registry. Immutable evidence is not accepted for consumption
  in its insertion transaction. Request/dispatch-echoed `success` still cannot
  finalize through the old `record_finality` function.
- Existing execute handlers call `consume_evidence` using their server-bound action
  and six scope values plus operation ID. No evidence fields are supplied by the
  customer. Restart recovery checks committed evidence before provider calls.
- The consumer requires immutable out-of-band `accounting_authorities`. Purchase
  authorities bind an already-created order and explicit transaction/settlement IDs,
  platform fee, merchant proceeds and provider fee; there is no order constructor
  or pricing default. It validates the exact quote/product/variant/quantity/price,
  customer, merchant, currency, unpaid order and absence of other transactions.
- With that authority, purchase consumption settles the actual savings-ledger
  reservation, inserts a real `public.transactions` payment and updates the existing
  `public.orders` payment accounting. Cancellation consumption supports the explicit
  zero-fee principal-to-owned-provider-wallet case: it settles the principal reserve
  and inserts a real external `refund` transaction without double-crediting an
  ordinary internal customer wallet. Interest accounts are not used by this posting.
- Queue insertion, operation transition, ledger settlement, public transaction,
  order update and immutable consumption receipt are one transaction. The queue
  itself remains immutable; `accounting_receipts` is its append-only consumed state.
  Pending queue queries must exclude operations with an accounting receipt.
- Responses: no receipt → `pending_verification`; verified receipt without usable
  accounting authority → `pending_projection`; committed accounting → `accounted`.
  `accounted` is not fulfilment, delivery, or a customer-complete claim.
  Pre-hardening queue rows without the matching independently stored evidence ID
  are rejected, not grandfathered into the consumer.

## Parent interface and remaining gates

1. Parent may construct `createSavingsExitEvidence` with the local recorder and
   route authenticated webhook bytes to `ingest`. The recorder is separate from
   the existing PostgreSQL role enum/catalog; no shared configuration change is
   required for this local constructor. The policy-writer catalog automatically
   picks up `exitConsumeEvidence` through its existing exit-statements import.
2. Full canonical-local lifecycle enablement remains a parent integration gate.
   `20260913140000_customer_savings_canonical_isolation.sql` deliberately rejects
   ledger activity for `goal_kind = canonical_local`. This lane does not bypass or
   weaken that guard. The private positive accounting fixture uses the existing
   preparation/ledger-compatible goal fixture, not a newly enabled canonical-local
   goal. The consumer rolls back if the guard rejects the settlement.
3. No production role/grant/scope or policy is provisioned. Fixture authority rows
   are SYNTHETIC ONLY, not owner approval. An approved provisioning path must bind
   actual economic terms, exact existing order, wallet ownership and account split.
   Nonzero provider fee, nonzero cancellation fee, split payment, paid-interest
   spending and new-order creation are deliberately not implemented by inference.
4. The new canonical receipt is not a legacy `customer_savings_redemptions` row.
   Parent must integrate customer progress/recovery and order cancellation/reversal
   with it before activation; legacy savings reversal assumes legacy balances.
5. Actual staging evidence must confirm the wallet-transfer category, outflow event
   transaction identifier and transaction customer identity semantics against the
   approved wallet mapping. Missing or different fields defer. Public docs establish
   lookup surfaces, not an owner-approved economic policy or delivery guarantee.
6. HTTP intake dispatch/retry wiring, deployment, full historical-schema replay,
   provider activation, live credentials, actual transfers and customer E2E remain
   unproven. No production/provider call was made. The full monorepo was not tested.

Provider references read (documentation only):
[single transaction](https://www.piggyvestbusiness.com/docs/api/transactions/single),
[TSQ](https://www.piggyvestbusiness.com/docs/api/transfers/status),
[wallet](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve),
[webhook envelope](https://www.piggyvestbusiness.com/docs/webhooks/payload).

## Verification

Final current-turn results: 160 focused tests passed; the two SQL adapter tests are
skipped in the ordinary suite and passed separately inside the private SQL harness.
Both exit SQL harnesses passed. Focused Biome, web TypeScript, tools-worker
TypeScript, shell syntax and tracked whitespace checks passed. All touched code
modules are under 300 lines. SHA-256 checks confirm all four pre-existing exit
migrations (`171000`, `171100`, `171101`, `171102`) remained byte-identical.

The new execution-consumer regressions first failed 3/4 against the existing
pending-verification implementation, then passed after integration. SQL exercises
same-transaction evidence refusal, wrong identity, cross-action, independent writer
privileges, duplicate no-op, missing authority, order mismatch, last-write rollback,
two-session lock contention and PostgreSQL restart replay. The adapter SQL test
uses mocked HTTP with the actual restricted recorder and COMMIT boundary.
The redirected-transaction response regression also failed before the transport
reuse (incorrectly returned `stored`) and passed afterwards (deferred without a
database write). Both wallets have explicit business/currency mismatch tests.

Commands run from `apps/web`:

```sh
pnpm exec biome check src/lib/piggyvest/savings-exit-*.ts src/schemas/savings-exit-*.ts
pnpm typecheck
pnpm exec vitest run src/lib/piggyvest/savings-exit-*.test.ts src/schemas/savings-exit-*.test.ts src/lib/piggyvest/runtime-composition-exit-execution.test.ts src/lib/piggyvest/postgres-statements.test.ts src/lib/piggyvest/prefunded-card-provider-request.test.ts
```

Commands run from the worktree root:

```sh
env PGDATABASE=wrong PGPORT=1 PGUSER=wrong PGHOST=invalid PGOPTIONS='-c exit_on_error=on' PGSERVICEFILE=/nonexistent PGpassBogus=ignore bash tools/test/savings-exit-accounting-local.sh
env PGDATABASE=wrong PGPORT=1 PGUSER=wrong PGHOST=invalid PGSERVICEFILE=/nonexistent PGpassBogus=ignore bash tools/test/savings-exit-execution-local.sh
shasum -a 256 -c /private/tmp/baci-exit-evidence-baseline.9XWtru/migration-sha256
git diff --check
bash -n tools/test/savings-exit-accounting-local.sh tools/test/savings-exit-execution-local.sh
```

The SQL harness loads real ledger, goal-policy, lifecycle, preparation and exit
migrations in the explicit order in `savings-exit-accounting-local.sh`, then the new
`192000`, `192100`, `192200` migrations. Order/transaction/item table definitions
come from the repository baseline, with fixture foreign keys; unrelated public
schema triggers and the complete migration history are not replayed. This is a
private dependency rehearsal, not a full-schema compatibility claim.

## Exact changed paths this turn

All paths below are relative to the worktree named above.

```text
apps/web/src/lib/piggyvest/savings-exit-accounting.test.ts
apps/web/src/lib/piggyvest/savings-exit-evidence.ts
apps/web/src/lib/piggyvest/savings-exit-evidence.test.ts
apps/web/src/lib/piggyvest/savings-exit-evidence.sql.test.ts
apps/web/src/lib/piggyvest/savings-exit-evidence-statements.ts
apps/web/src/lib/piggyvest/savings-exit-evidence-statements.test.ts
apps/web/src/lib/piggyvest/savings-exit-evidence-store.ts
apps/web/src/lib/piggyvest/savings-exit-evidence-store.test.ts
apps/web/src/lib/piggyvest/savings-exit-execution.ts
apps/web/src/lib/piggyvest/savings-exit-execution.test.ts
apps/web/src/lib/piggyvest/savings-exit-execution-handler.ts
apps/web/src/lib/piggyvest/savings-exit-execution-handler.test.ts
apps/web/src/lib/piggyvest/savings-exit-execution-statements.ts
apps/web/src/lib/piggyvest/savings-exit-execution-statements.test.ts
apps/web/src/schemas/savings-exit-evidence.ts
apps/web/src/schemas/savings-exit-evidence.test.ts
apps/web/src/schemas/savings-exit-execution.ts
apps/web/src/schemas/savings-exit-execution.test.ts
supabase/migrations/20260926192000_savings_exit_evidence_storage.sql
supabase/migrations/20260926192100_savings_exit_record_evidence.sql
supabase/migrations/20260926192200_savings_exit_consume_evidence.sql
tools/test/savings-exit-accounting-local.sh
tools/test/savings-exit-accounting-tables.sql
tools/test/savings-exit-accounting-fixture.sql
tools/test/savings-exit-accounting-evidence-setup.sql
tools/test/savings-exit-accounting-cases.sql
tools/test/savings-exit-accounting-restart.sql
tools/test/savings-exit-execution-local.sh
docs/savings-exit-evidence-accounting-2026-09-26.md
```
