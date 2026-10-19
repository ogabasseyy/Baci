# Prefunded card contribution handoff — lane 2

## Delivered local boundary

`prefundedCardContributionSchemas.input` validates the immutable operation
scope, kobo amounts, separate collection/transfer references, treasury source
and destination, atomic reservation result, collection evidence, transfer
evidence, and completion-claim state.

`evaluatePrefundedCardContribution` is a server-only, side-effect-free state
classifier. It does not call Paystack or PiggyVest, write a ledger, dispatch a
transfer, charge a card, or issue a refund. It prevents completion unless both
legs correlate exactly and a trusted durable canonical-projection snapshot is
already present. It is not an exactly-once implementation.

The classifier is intentionally closed by default: `transferContract:
'unverified'` returns `dispatch_blocked`, even after a verified collection.
PiggyVest's published wallet-transfer documentation says `202` only schedules
processing, and its published TSQ example does not establish source and
destination identity for a peer-wallet transfer. A restricted adapter must not
pass `captured_and_reviewed` until a controlled staging transfer captures and
reviews the exact terminal/webhook contract.

## Parent wiring

The parent-owned replay store/crypto/runtime boundary must add a durable
operation with unique `(environment, integration, collection_reference)`,
`(environment, integration, transfer_reference)`, and idempotency/fingerprint
constraints. The same durable transaction must:

1. Persist the immutable operation and atomically reserve goal capacity plus
   treasury float before collection dispatch.
2. Accept only server-verified collection evidence matching the saved method,
   amount, currency, and collection reference.
3. Lease one restricted worker for the transfer; after a lost response or lease
   expiry, verify the allocated transfer reference instead of re-dispatching.
4. Persist normalized terminal evidence only after it verifies the expected
   reference, source, destination, amount, currency, and provider transaction
   identity.
5. Atomically claim and read the canonical contribution projection with the
   operation and provider transaction identity. Feed a trusted snapshot binding
   operation, full scope, request fingerprint, provider transaction, amount,
   currency, and canonical projection ID into this gate; do not infer it from a
   transfer status or a bare claim ID.

The customer-facing route must remain authenticated, CSRF-protected, and RLS or
RPC scoped. It supplies no wallet IDs, treasury binding, provider evidence, or
completion status from the request. Provider credentials and calls remain in a
restricted worker, not a user route.

## Reconciliation rules retained here

- Collection mismatch, unknown collection, or reversal never authorizes a
  transfer.
- If a reservation is unavailable after verified, unknown, or reversed
  collection evidence, the operation is reconciliation-required. It is not a
  precharge refusal and authorizes neither transfer, recharge, nor refund.
- Pending transfer remains pending and cannot complete savings.
- Unknown transfer prohibits refunds until terminal transfer evidence exists.
- Verified transfer failure requires an explicit, durable operator refund
  decision; this module never initiates one.
- Terminal transfer success without a trusted durable projection snapshot
  remains `ready_for_projection`, preventing duplicate customer credit.

## Activation blockers

No customer card control may be enabled until the parent wiring has durable SQL
and concurrency/restart coverage, a dedicated staging treasury binding with
approved zero-fee behavior, and captured peer-wallet terminal evidence. The
published PiggyVest docs establish a wallet-transfer request and that finality
must come from webhooks or repeated TSQ, but do not by themselves establish
the peer-wallet terminal identity mapping this bridge requires. The selected
staging model admits only zero fee allowance; any fee policy needs a separately
reviewed contract and a new explicit design revision.
