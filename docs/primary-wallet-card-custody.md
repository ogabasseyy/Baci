# Primary card treasury and signed custody handoff

Source, mocked HTTP and isolated PostgreSQL only. No provider requests, financial actions, deployment, production configuration, role provisioning, secrets, existing migration edits, mobile edits, webhook-route edits or replay-registry edits were performed in this task. The customer integration is **not live/finished**. `custody_pending` is not completion.

## Exact source changes

- New append-only migrations `20261007200300` through `20261007200800`: owner treasury policy, reservations, transfer outbox, separate transfer/custody capabilities, shared custody transaction aliases, settlements, receivables, completion outbox, shared bank/card ledger identity and terminal reconciliation guard.
- New `apps/web/src/lib/piggyvest/primary-wallet-card-custody-*` schema-backed executor, runtime parser, reader, proof verifier, signed boundary and concrete connection; `primary-wallet-card-transfer-worker.ts` dispatches an injected approved adapter once. Each runtime file has colocated tests.
- Own checkout schema/service now recognize `completed`; status reads the durable terminal state without another Paystack verification or exposing an old checkout URL. Existing checkout storage/authorizer/evidence migration files were not edited.
- New local PostgreSQL fixtures cover treasury, settlement rejection and concurrent bank aliases. The fixture loads actual existing treasury readiness/identity guards; its minimal legacy scaffolding cannot execute legacy checkout.

## Treasury ownership and safety

Reservation is an AFTER INSERT trigger on the durable checkout operation. Missing treasury foundation/policy or invalid owner evidence rolls back the operation before collection. A duplicate idempotency insert does not reserve twice. The policy explicitly selects the existing `prefunded_card.treasury_bindings` ID, immutable owner login/source wallet and operation/daily/reserved ceilings. Its identity and ceilings cannot be updated; enabling/disabling remains owner controlled.

The reservation locks and increments the **existing shared** `reserved_kobo`. Capacity subtracts both existing reservations and consumption, including legacy prefunded usage; it never creates new float or resets existing counters. The actual existing `treasury_reservation_ready` enforces identity, enabled registry, immutable opening/replenishment evidence and a fresh matching snapshot. Collection initialization and transfer claiming recheck readiness. Stale/suspended treasury fails before financial dispatch.

Verified one-time Paystack collection atomically creates the transfer outbox. The immutable command has amount/NGN/source/destination and reference `pvb-primary-transfer-<operation UUID>`, with no goal or reusable-authorization requirement. One claim changes `ready` to `dispatching`; only its token records `submitted` or `unknown`. Neither state, nor a crash while dispatching, can be reclaimed and dispatched again. A lost acknowledgement fails the worker. Unknown/failed/uncollected operations retain reservations: cancellation/refund/release requires a separately approved reconciliation design, not a timer or second transfer.

## Signed custody and exact-once ledger

`createPrimaryCardCustodyConnection` connects concrete restricted PostgreSQL calls to dispatch and signed settlement. Runtime configuration pins integration, environment, merchant, business, current deadline, approved crosswalk contract/issuer, treasury webhook customer and transaction customer. The worker loads and validates the database-owned operation context before dispatch. These canonical customers are explicitly configured; neither is assumed to equal the business ID.

Exact raw bytes must pass existing HMAC-SHA512 verification before a context read or provider observation. The only recognized internal event is `wallet-transfer.outflow.success` / `wallet-transfer`. Independent bounded authenticated GET observations must prove successful zero-fee wallet transfer, exact deterministic reference, amount, source/destination/business and active NGN wallets. The destination API customer must agree with an authenticated complete crosswalk to the verified primary wallet's canonical webhook customer.

Malformed/nonmatching evidence yields `deferred` without a settlement. Context/provider/crosswalk delivery I/O failures, malformed storage context, settlement write failures and invalid settlement acknowledgements **propagate** for retryable HTTP/worker failure. Do not catch them and return successful webhook delivery. Outbound errors must remain generic; never log/return raw provider/database errors or secrets. A deferred observation also needs durable quarantine/retry intake; it is not a completed or safe-to-discard payment.

Settlement has a dedicated custody capability and a shared per-integration advisory lock with the existing environment-scoped bank inflow function. It binds all immutable operation economics, collection, reservation, owner treasury and verified customer mapping. It atomically:

1. Claims all authenticated transaction aliases into the shared primary inflow receipt namespace.
2. Reuses one matching prior primary inflow receipt without another credit, or writes one primary wallet ledger transaction/receipt itself with the existing numeric limits and ownership guards.
3. Moves shared treasury reservation to consumption exactly once, preserving legacy balances and `total_earned`.
4. Writes settlement, collection receivable, pending completion outbox and terminal `completed` together.

Repeated events/proofs cannot debit or credit twice. Changed financial proof conflicts. Multiple already-credited receipts under the approved aliases conflict and require reconciliation; they are not silently merged or refunded. Overflow or any write failure rolls back balance, receipt, aliases, consumption and completion.

**Bank-before-proof protection:** unmatched signed bank inflows for a customer with pending/reconciliation card custody return the existing `conflict` outcome before credit. They must be retained/retried by the parent signed inbox; this deliberately also defers unrelated bank deposits during that pending window rather than guessing identity from equal amounts. Already-credited exact duplicates still deduplicate. Once custody settlement publishes approved aliases, corresponding bank events return `duplicate`, whether their ID is canonical or the bank alias. Historical matching receipts can be adopted without another credit. Unknown IDs after completion cannot be identified by amount: activation therefore requires the provider's exhaustive alias contract, not merely a successful transfer response.

The appended `20261007200800` replaces only `flag_reconciliation`, permitting `reserved`, `initializing`, `init_unknown` and `ready`. A late verification cannot change `custody_pending` or `completed`. The original `20261007200200` file/hash stays intact.

## Exact provider and crosswalk prerequisites

No new provider endpoint is invented. Existing source mechanics supply authenticated GET paths:

- `/api/v1/transaction/<signed pvb_reference>?wallet_id=<owner source>`: canonical transaction ID, transaction customer, successful `wallet_transfer`, source/destination, amount, zero fee and our `third_party_reference`.
- `/api/v1/transaction/verify?reference=<stored reference>&wallet_id=<source>`: successful status and exact reference/amount.
- `/api/v1/wallet/<source>` and `/api/v1/wallet/<destination>`: exact IDs, business, active NGN status; destination `api_customer_id`.

Before activation obtain approved environment-specific API response evidence and authenticated provider crosswalk proving:

- Owner source wallet's exact signed webhook customer and authenticated transaction customer; they may differ from each other and the business ID.
- The destination public wallet/API customer/canonical webhook customer belong to the same verified customer and merchant/integration/business.
- The internal transaction canonical ID and **every** corresponding signed bank-inflow `eventData.transaction_id` are the same economic credit. `bankInflowTransactionId` must occur in a unique complete `transactionAliases` list (1–8), which includes the canonical ID; `aliasesComplete: true` is accepted only from the configured authenticated issuer/contract.
- Timestamp, expiry and SHA-256 evidence provenance for the crosswalk. No mapping is derived solely from equal amounts, browser input, reusable authorization, arbitrary object claims or a provider balance.

`resolveAuthenticatedCrosswalk` is a required trusted server adapter. There is no default, guessed endpoint or hard-coded actual customer mapping. Contract/issuer and canonical source/transaction customers must match deployment configuration, and destination identities must match authenticated API/verified DB mapping. **The actual approved crosswalk values, issuer delivery and exhaustive alias evidence are still missing.** A literal authority label alone does not authenticate a caller-supplied object.

## Runtime/parent wiring still required

`readPrimaryCardCustodyRuntime` reads only trusted `PIGGYVEST_PRIMARY_CARD_*` deployment settings, not request values. It defaults unavailable unless `CUSTODY_ENABLED=true`, rejects environment/deployment mismatch, missing issuer/contract/customer identities/credentials, malformed settings or current expiry. Use the checkout's existing integration/merchant/business/environment/expiry/database settings plus `PIGGYVEST_TOKEN`, `PIGGYVEST_WEBHOOK_SECRET`, `TRANSFER_PASSWORD`, `CUSTODY_PASSWORD`, `CROSSWALK_CONTRACT_ID`, `CROSSWALK_ISSUER`, `TREASURY_WEBHOOK_CUSTOMER_ID` and `TRANSACTION_CUSTOMER_ID` suffixes. It requires no Paystack credential or historical staging deadline. Database settings independently enforce their current enabled expiry. No runtime values were provisioned or changed.

Parent gates, explicitly not hooked here:

1. Register/review migrations and provision constrained login memberships, owner-selected treasury foundation/policy, ceilings, snapshots and approved runtime identities/configuration. A staging treasury registry is not a production authorization; production needs its own explicitly approved foundation and provider contract.
2. Connect durable signed inbox intake/correlation to `connection.applySignedCustody({ operationId, rawBody, signature })`. Resolve operation from stored outbox/reference/context; preserve exact signed bytes. Keep bank `conflict`/deferred events retryable/quarantined rather than acknowledging and dropping them. Do not modify the existing PiggyVest webhook route or parent replay registry in this task.
3. Schedule transfer outbox dispatch through `connection.dispatch(operationId)` and supply `submitApprovedTransfer`. Existing documented wallet-transfer transport is `POST /api/v1/transfer/wallet` with amount/source/destination/NGN/reference; adapt its current verified acceptance contract to the immutable command without a fake goal or expired staging configuration bypass. This task deliberately includes **no financial HTTP adapter or provider financial call**. Acceptance means submitted, not custody.
4. Supply the approved authenticated exhaustive crosswalk adapter; reconcile ambiguous dispatch/collection, failure, expiry and already-credited conflicts before deciding release/refund. Never issue a second reference to resolve uncertainty.
5. Drain completion outbox for notifications/cache and reconcile Paystack settlement into the outstanding receivable. Receivables do not replenish treasury; use independently approved existing replenishment controls. Refunds/chargebacks and collection fees require operational ownership. No new automated refund, release or replenishment is implemented.
6. Parent UI integration must retain card collection and show pending until stored signed ledger completion. Legacy Paystack funds stay legacy-backed. No mobile wiring or live end-to-end validation is claimed.

## Local validation

Final scoped run passed **145 tests across 19 files**, scoped Biome passed **20 TypeScript files**, and the full isolated PostgreSQL fixture plus three-session concurrency assertions passed. All new source/test/migration files remain below 300 lines. The concurrent observations returned retryable bank conflicts before signed custody completed; subsequent bank alias replay deduplication is separately exercised by the full fixture. Isolated clusters were stopped after each run. No broad typecheck or live/provider validation is included in these results.

Run focused node tests from `apps/web` with `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec vitest run --environment node` over `primary-wallet-card-custody*.test.ts`, `primary-wallet-card-transfer-worker.test.ts`, custody schema tests and existing checkout/route/transport tests. Scoped Biome applies only to this task's TypeScript files, all below 300 lines.

Run `primary-wallet-card-custody.integration.sql` only in a fresh isolated local PostgreSQL cluster with a private temporary Unix socket and TCP disabled. It includes the earlier checkout fixture and new append migrations, exercises current treasury readiness, private grants, identity/cap limits, idempotency, one-time claims, stale/suspended treasury, invalid proofs, atomic overflow rollback, bank-before-proof deferral, historical receipt reuse, card-before-bank alias deduplication and completed-operation reconciliation protection.

For concurrency, load the same fixture with `-v hold_custody=1`; run three concurrent psql sessions against `primary-wallet-card-custody-concurrency.integration.sql`: default custody settlement, `-v bank_race=1 -v alias_prefix=bank-`, and `-v bank_race=1 -v alias_prefix=canonical-`. After all finish, run it with `-v assert_race=1`. Assertions require one new ledger credit/settlement and one treasury consumption even when both bank aliases arrive before the proof. Stop the isolated cluster afterward.

Regression evidence: the narrowed-I/O tests first reproduced four false `deferred` acknowledgements; the actual PostgreSQL terminal test first reproduced completed-to-reconciliation mutation before the appended fix. Broad provider/TSX validation failures belong to the parent; no broad typecheck/build/provider suite was run here.
