# Delivery and office pickup staging setup

User authorized using existing Ogabassey settings for the synthetic checkout.
Read the published store through its anonymous-safe public snapshot, shipping
rates and sender RPCs. Source: Nigeria origin, GIGL enabled, no configured custom
rates or zones beyond catch-all; the production slug has legacy free Ikeja
collection in the storefront.

Applied only to the existing isolated `savings-synthetic` merchant:
- Copied the public office business address, country and state.
- Matched carrier selection to GIGL.
- Added an active Lagos-only zone and zero-cost Store Pickup merchant rate using
  the same office location. This exercises standard merchant-configured pickup,
  without weakening the real Ogabassey slug restriction or offering free pickup
  to unrelated merchants.
- Preserved contact fields, customer identity, merchant ownership, applications
  and existing orders. No carrier credentials copied or reset.

Setup backup: runtime/private/shipping-config-before-20261025.json, outside Git.
Initial transactions rolled back on identity/audit guards. Final provisioning
preserved sensitive contact fields and used the supported database-principal
audit actor setting for the existing synthetic owner. No triggers disabled.

The public quote route also read merchant rates through its admin client. In the
portable runtime that credential is deliberately disabled; the RPC returned
PGRST301 and pickup discovery failed soft into an empty result. Changed only
that anonymous-safe rate read to createPublicClient, with a regression test
that fails before the change. Remaining legacy administrative quote paths were
not expanded or newly authorized by this change.

Validation: 286 tests in 44 shipping/rate/delivery test files pass. Web TypeScript
check and affected Biome checks pass. Browser shows Store Pickup, the office
address, zero fee and an enabled Continue to Payment after selection. Reopened
the delivery panel for user testing. No order, booking, OTP, approval, activation,
settlement or shipping booking submitted.

Door delivery still requires carrier credentials. The portable runtime has no
GIGL email/password configuration. Provider keys were not copied from production.

## Order submission error follow-up

The user attempted checkout and received HTTP 500,
`Unable to verify the selected shipping rate`. Server verification still used
the disabled admin credential and received PGRST301. Its earlier optional
replay probe also logged PGRST202 for the missing staging-only
storefront_checkout_replay_snapshot function and correctly fell back to full
verification. The actual failure occurred before the order-create RPC.
Read-only reconciliation found zero orders for the synthetic merchant since
19:54 UTC on 25 October. No submission was replayed by the agent.

Changed the rate verification RPC read to createPublicClient, retaining merchant,
zone, currency, canonical subtotal and fee validation. The new regression fails
against the previous implementation. Other legacy privileged order mutation and
replay paths were not expanded by this change. No production migrations applied.

## Explicit owner retry — popup opened

User authorized retrying checkout once to open Oxygen, keeping activation and
settlement disabled. Clicked Continue to Payment, then Begin Process once.
POST /api/orders returned 201. Created order:
690a9d2e-33b7-4106-8c68-b9019f814dce, total 198000, office pickup fee zero.
The actual checkout navigated to its oxygenOrderId and displayed Verify your
identity with blank BVN/NIN/date fields. No identity data entered and no OTP,
Oxygen booking, approval, activation or settlement triggered by this retry.

Remaining server diagnostics: optional replay snapshot RPC absent in this
staging DB; optional legacy idempotent pre-check fails with disabled admin
credential; post-create merchant pickup metadata stamp fails with the same
PGRST301 credential issue. The order itself exists, so DO NOT create another
order or repeat submission to repair metadata. Repair/reconcile this exact
order through the appropriate authorized normal-client path. No older orders
or indeterminate bookings were touched.

Screenshot: /tmp/oxygen-checkout-retry-popup.png
