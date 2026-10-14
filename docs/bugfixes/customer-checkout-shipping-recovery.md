# Paid checkout shipping recovery

## Scope

An owner can explicitly confirm a delivery destination and complete pin for a
paid, processing, domestic GIG address-delivery order funded at checkout. No
coordinates are copied automatically from a legacy quote. Pickup-station and
international orders fail closed and require separate review.

This recovery is separate from PR #3687, which prevents coordinate loss on new
orders. Neither change books an existing order automatically.

## Operator flow

1. Open the order's Ship sheet, choose GIG, and open destination recovery.
2. Confirm address, city, state and phone; select a verified pin through the
   existing address search, or enter a verified coordinate pair manually.
3. Preview a fresh quote. Previewing never changes the order or reserves a
   shipment. The provider payload is staged privately for up to five minutes.
4. Compare the preview with the shipping fee already paid. A different price
   cannot be saved here; this feature introduces no payment adjustment policy.
5. Explicitly confirm the destination/pin and save the same-price quote.
6. Use the existing Book action separately when ready.

Editing the destination invalidates its preview and acknowledgment. Busy
requests disable editing, dismissal, mode changes and booking. Saving a quote
does not call the booking function, reserve wallet funds or create charges.

## Server and database boundaries

`POST /api/orders/:id/shipping/checkout-recovery` supports `preview` and
`confirm`. Both require authenticated merchant ownership, orders edit/fulfill
permissions and CSRF protection. PostgreSQL independently checks ownership,
actor/order binding, paid checkout funding, processing state, shipment/booking
locks, cancellation/refund state and existing settled/internal-credit retention.

The keyed context fingerprint binds the order version/address/selected quote, merchant
sender and authoritative item/package inputs. Its server HMAC prevents guessing
restricted internal economics from a public hash. Mutable rows are locked through
each RPC. Edits committed while the external quote request is in flight invalidate
the fingerprint at prepare; edits after preview invalidate confirmation.

Preview uses the existing GIG adapter, authoritative order items and merchant
sender, and preserves the selected service tier/carrier. Repeated trailing city/state text is removed from the carrier street while
preserving the confirmed pin and separate locality fields. The API signs the full
payload with the existing shipping quote route proof. PostgreSQL verifies it
before storing the quote in a private preview table. Clients receive only an
opaque preview UUID, redacted public quote and paid fee, never the proof,
internal tariff/margin or provider response.

Confirmation serializes with the existing order-payment boundary, locks the
order and its mutable quote/funding inputs, and verifies actor, fingerprint,
expiry and unchanged paid price again. It updates the explicitly confirmed
destination and invokes the existing validated refreshed-quote writer in one
transaction. The real economics stamp trigger preserves prepaid snapshots.
Invalid quote economics roll back the destination update. Confirm retries are
idempotent for the same already-confirmed destination and selected quote.

The private preview record retains actor, original destination, signed replacement
inputs, creation/expiry and confirmation time as audit evidence. It has no client
table grants or RLS policies. An hourly pg_cron sweep purges unconfirmed rows
past expiry plus a one-day grace window; confirmed rows keep their audit keys
while destination and economics are redacted past ninety days. Private helpers are not executable by clients;
public recovery functions are granted only to authenticated users and authorize
each invocation. No service-role client fallback was introduced.

## Delivery and verification

Apply every recovery migration before deploying the web API, then release the
mobile UI: `20261013213516_customer_checkout_shipping_recovery_context.sql`,
`20261013213522_customer_checkout_shipping_recovery_confirmation.sql`,
`20261014080000_customer_checkout_shipping_recovery_scalar_address.sql`,
`20261014120000_customer_checkout_shipping_recovery_review_followups.sql` and
`20261014130000_customer_checkout_shipping_recovery_hardening.sql`.
The automated migration runner applies the whole directory; a manual rollout
must include every recovery migration or legacy scalar destinations stay
unbookable and the context schema check fails closed. No native dependency
changed. The repository has production EAS Update
support: a compatible installed runtime can receive a JavaScript update; an
incompatible runtime needs the normal new app binary. No deployment, OTA publish,
production database write or live carrier call was performed during development.

Regression tests cover the real production TypeScript signer, PostgreSQL proof
verifier, refresh writer, latest economics stamp and internal-credit retention
helper. They include same-price confirmation, changed-price rejection, actor
isolation, malformed proofs/pins, stale address/item/product data, cancellation/
refund/booking guards, expiry, rollback on invalid economics, concurrent confirm
idempotency and a concurrent product editor blocked by input locks.

API and mobile tests cover auth/CSRF, public-data redaction, service preservation,
explicit acknowledgment, no automatic requests/booking/funding, stale responses,
search edit invalidation, busy controls and local expiry/ETA display. Native
emulator verification is outstanding; `adb` is unavailable in this workspace.

## Signing boundary

Recovery stages through a server-only, fixed-action preparation helper. It
checks order identity, complete pins, domestic GIG delivery and the unchanged
paid fee before minting the existing HMAC proof. Trusted merchant identity is
explicitly bound into the quote request because the booking request builder
does not include it. The helper uses only the caller's RLS client and the
recovery preparation RPC. The credential manifest permits exactly the reviewed
route-to-helper-to-signer path; direct signer access and sibling-route reuse
remain rejected by regression tests.
