# Prefunded card execution rehearsal

This is an inactive staging execution bundle, not a deployed card-funding feature.
It now includes provider adapters, one-step execution/reconciliation, protected
treasury observations and canonical principal projection. No route, scheduler,
credentials, goal enrollment, or mobile charging capability is activated here.

Run the private Unix-socket PostgreSQL rehearsal with:

```sh
bash tools/test/run-prefunded-card-storage-local.sh
bash tools/test/run-prefunded-treasury-local.sh
python3 tools/test/prefunded-card-projection.test.py
```

`storage.sql` creates the private tables and reservation function.
`storage-functions.sql` supplies the sole claim/record/reconciliation functions.
For the combined rehearsal, load those two first, followed by
`treasury-storage.sql`, `treasury-functions.sql`, `projection-storage.sql`,
`projection-functions.sql`, `projection-inflow-guard.sql`, and
`projection-admission.sql`. The harness loads the real canonical ledger and legacy
inflow projection prerequisites. Application roles are denied. There is no live
installer or migration registration for this bundle.

The reservation serializes conservative float and goal capacity. New sends require
a fresh enabled treasury and locked registry, canonical binding, mapping, customer,
saved method, and active goal. An ambiguous send never gets another send claim.
The dispatcher reports submission only, not collection or transfer settlement.

Historical verification intentionally does not require current card/goal eligibility:
a revoked method or cancelled goal must not hide an already-incurred provider
outcome. It still requires the scoped operation/treasury/session, correlated evidence,
and current verification token/fence/lease. Collection failure releases a reservation
once; verified transfer consumes it. Neither submission nor collection alone
credits savings. After both verified legs, the projector atomically writes the
canonical ledger, contribution, goal amount and durable projection receipt.
An already-applied operation returns duplicate without another credit.

The SQL rehearsal covers wrong worker sessions, changed eligibility, locking against
concurrent revocation, eight identical first reservations, unknown non-resend,
expired/replaced verifier leases, historical verification after revocation,
duplicate release, malformed/overflow evidence, and persistence after restart.

The combined harness invokes the actual TypeScript store, provider adapter and
runtime against a new Unix-socket PostgreSQL instance. Provider HTTP is mocked:
a lost collection response becomes verification-only, and a successful transfer
credits once. Eight concurrent projectors, failed-write rollback, physical DB
mismatch, stale float, legacy inflow duplicates and restart are also exercised.
This does not establish real provider settlement or phone readiness.

Provider submissions require a test Paystack key and the exact staging PiggyVest
origin/business/treasury scope. Paystack success is verified against the stored
test authorization and customer. PiggyVest verification requires complete wallet,
customer, business, amount, currency and reference evidence. The documented TSQ
response may lack this identity: it remains deferred until correlated independent
evidence is available, never filled from the expected request.

Credit-route enrollment is explicit, immutable and database-pinned. Historical
goal principal must already agree with the canonical ledger. A known correlated
bank-inflow alias is a duplicate; unlinked inflows to an enrolled bridge goal are
deferred rather than guessed. The separate evidence bundle adds explicit verified
external-deposit attribution; it must be installed and connected to original signed
receipt replay before mixed ordinary bank/card funding can be activated.

When the evidence bundle is installed, the public legacy inflow wrapper delegates
enrolled deposits to `apply_verified_legacy_inflow`; it does not bypass the stored
evidence, reader identity or canonical projection checks. Enrollment also follows
the stored event's destination when the envelope wallet differs. Missing evidence
defers and conflicting fields require reconciliation. Without the evidence bundle,
uncorrelated enrolled deposits still refuse; non-enrolled wallets retain the existing
legacy branch. Public-wrapper regression source was added during the performance
window and has not yet run.

The next local continuation adds the saved-authorization resolver, customer intake,
dispatch queue, reversal handling, and independently verified provider evidence.
These are source implementations, not an activated card-funding feature. The runner
never automatically replenishes float from a card charge.

## Customer and worker composition

`customer-entry.sql` accepts only an existing scoped goal, saved method, integer
kobo amount and UUID idempotency key. It resolves the treasury and destination in
SQL, checks current customer ownership, and requires an independently provisioned
active authorization before a new reservation. Retrying an existing request does
not reserve again or require the card still to be active. Changed payloads conflict.
The customer has no control over wallet IDs, provider references or verified proof.

`prefunded-card-customer-handler.ts` provides authenticated, CSRF-protected POST
and scoped GET status handlers, composed at `/card-contributions` in the **local**
runtime only. This is not yet a public Next route or mobile card-funding connection.

Load `customer-entry.sql` after the authorization bundle described in
`authorization-README.md`, then `dispatch-queue.sql`. The worker's claim pins
integration, business, physical database, merchant and treasury. A sibling treasury
cannot have its operation claimed by the wrong provider adapter. Expired leases
recover after restart. Already-sent transfers remain verification jobs after a
collection reversal, including queue installation over existing unknown transfers.
No automatic resend or unsafe release of reserved float is introduced.

`createPrefundedCardExecution` composes the real stored-authorization resolver,
provider adapters, independently stored transfer evidence, operation store,
reversal verifier, state machine and queue worker. It rejects inconsistent scope
or provider configuration before SQL/network access. A reported reversal is
independently verified before its durable obligation is recorded; an internal
verification deduplication key is not claimed to be a provider event identifier.

`createPrefundedCardReceiptReplay` connects original signed receipt bytes to
independent evidence ingestion and bank projection using separate executors.
It retries deferred verification or projection, propagates storage failures, and
retries projection even when evidence already exists. Outflow evidence never
enters the ordinary bank-credit path. This adapter is not a new public webhook,
durable inbox, scheduler or promise of real provider delivery. Its caller must
retain the original receipt and honor the returned retry/reconciliation outcomes.
The adapter and its tests were added during the performance window and remain
unvalidated until the owner releases that window.

The restricted executor exposes fixed customer/worker/provisioning/evidence
statement profiles. Profiles constrain code paths; they do not assert separate
database authority where an immutable treasury/ledger binding requires the same
operator login. Provisioning and evidence ingestion retain separate credentials.
See `authorization-README.md`, `evidence-contract.md`, and the executor source for
exact callable surfaces. Never install disposable fixture data or test roles as a
shortcut to approved deployment.

Additional private checks:

```sh
bash tools/staging/prefunded-card/authorization-local.test.sh
python3 tools/test/prefunded-card-customer.test.py
bash tools/test/run-prefunded-reversal-local.sh
python3 tools/staging/prefunded-card/evidence-local.test.py
python3 tools/test/prefunded-card-postgres-executor.test.py
```

Still required for customer availability: first-card authorization collection and
consent, public route/mobile integration, scheduled invocation and receipt replay
delivery, approved credentials/role/treasury provisioning, independently verified
company float and genuine provider settlement. Recurring debits are not enabled by
this one-off customer request queue. Source/SQL rehearsal is not phone readiness.

## Provider contracts checked

Checked against the official references on 26 September 2026:

- [PiggyVest wallet transfer](https://www.piggyvestbusiness.com/docs/api/transfers/wallet):
  a 202 processing response is not terminal settlement; amounts are integer kobo.
- [PiggyVest TSQ](https://www.piggyvestbusiness.com/docs/api/transfers/status):
  the documented response includes reference, status and amount, but does not
  supply all fields this bridge requires for destination/customer attribution.
  Do not fabricate missing fields from the request to force a positive result.
- [Paystack charge authorization](https://paystack.com/docs/api/transaction/#charge-authorization):
  reusable authorization charging supports an explicit currency. This adapter
  sends the validated NGN currency rather than relying on the integration default,
  and serializes the integer-kobo amount as the documented string parameter.
