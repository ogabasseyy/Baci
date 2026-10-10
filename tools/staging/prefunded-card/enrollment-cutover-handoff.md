# Prefunded-card legacy enrollment cutover review

Review is source-only against the migrated staging shape described in
`legacy-history.md`: one 10,000-kobo canonical opening, one public contribution,
one provider evidence row, one bank projection, and no credit route. No live DB,
provider, secret, or deployment access was used. The 29 September lease is unchanged.

## Fixed replay gap

The migration deliberately keeps two transaction identities: the historical UUID
is the canonical operation ID and remains in evidence references; the provider's
`PVB…` transaction ID keys `bank_projections`. Once a credit route exists, the
public recognizer delegates the old webhook arguments to
`apply_verified_legacy_inflow`, which requires its `p_provider_transaction_id` to
equal the evidence's PVB ID. The old webhook passes the historical UUID, so the
already-projected receipt returns `reconciliation_required` instead of `duplicate`.
`evidence-legacy.sql` now permits that mismatch only when a full join proves the
legacy UUID is the deterministic opening operation and links the same integration,
PVB-keyed bank projection, public contribution, original public credit row, and
staging inflow projection with matching scope, wallet, amount, event, reference,
session, and timestamp. The ordinary PVB ID path remains valid. A references-array
member alone does not qualify. No canonical or public credit is added on either
duplicate path.

The focused `enrollment-cutover.test.py` passes against disposable PostgreSQL. It
covers both IDs, wrong amount/customer/wallet, unknown UUID, an unrelated reference
member, changed event, unmatched fresh receipt, and unchanged contribution, goal,
ledger, and bank-projection totals.

Fresh bank credits still require the original signed receipt replay path; the
migrated owner proof records unavailable signature status and
`provider_reconciliation`, so that row alone must never stand in for fresh HMAC
verification. `createPrefundedCardReceiptReplay` verifies raw receipt HMAC before
ingestion, but its scheduler/public webhook hookup is not present in the reviewed
source.

## Required cutover gate

The migration bundle itself calls out that a later route cutover must re-reconcile
legacy inflows since the migration snapshot. The route-present branch in
`resolve_replay_enrollment` only checks the route and canonical binding, then
returns `enrolled`; it does not prove that public goal principal, contributions,
canonical ledger principal, and bank projections still reconcile after the old
recognizer ran. Before inserting the immutable route, add an owner-controlled
transactional cutover that locks the goal and replays/reconciles every intervening
legacy inflow using both identities, proves public and canonical totals plus the
full contribution/projection set match, and installs the route in that same
transaction. Preserve the old recognition path until this gate commits. Subsequent
ordinary bank receipts must enter the original-byte HMAC replay flow, which
classifies and deduplicates the migrated receipt against its existing PVB-keyed
projection.

## Evidence distinction

The migrated evidence observation is `verified` for provider reconciliation, but
the signature-unavailable provenance is in the owner proof, not a durable field in
`provider_evidence`. Fresh ingestion verifies HMAC in application code before SQL
recording. Keep that trust boundary explicit in activation wiring: routing hints and
the migrated row can select/identify the existing projection, while only a newly
verified original receipt may enter fresh evidence ingestion. No route enrollment
or activation is performed by this review.
