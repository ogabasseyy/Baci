# Petrock contract and curated service mappings

Verified against the [DHRU reseller API documentation](https://github.com/dhru-com/reseller-api)
and read-only Petrock account/catalog requests on 2026-10-25. This records the
current implementation; the integration plan preserves the original decisions.

## Existing curation

The filtering and mapping groundwork landed in [PR #3066](https://github.com/ogabasseyy/Baci/pull/3066):

- `apps/web/src/lib/imei-providers/tier-bindings.ts`: active info-check bindings.
- `apps/web/src/lib/imei-providers/petrock/petrock-info-tier-candidates.ts`: 22
  additional candidates, kept dark until captured results establish coverage.
- `apps/web/src/lib/imei-remediation/petrock-remediation-product-parser.ts`:
  carrier, model, status and refund classification plus exclusion filters.
- `apps/web/src/lib/imei-remediation/petrock-remediation-catalog.ts`: persistence
  projection. Sync preserves the separate review/activation controls.

No candidate or unlock service is approved merely because it appears in the
supplier catalog. Preserve the selected service scope and review controls.

## Current bindings

Prices and field names below were read from the live catalog without placing orders.
Public NGN prices are unchanged; the existing 125% supplier-price ceiling remains.

| Use | Product ID | Exact field | Baseline USD |
| --- | --- | --- | --- |
| Blacklist (rejected; blocked in diagnostic and house-check routing) | 1955 | `IMEI` | 0.04 |
| Knox Guard | 699 | `IMEI/Serial No` | 0.09 |
| Pixel info | 721 | `IMEI` | 0.09 |
| Samsung info | 741 | `IMEI` | 0.08 |
| SIM lock | 716 | `IMEI` | 0.06 |
| House carrier + SIM-lock detection | 689 | `IMEI/SN:` | 0.07 |

Product 693 is no longer listed. SIM-lock-only and carrier-detection checks use
separate replacements because carrier eligibility also needs carrier evidence.
The Apple info probe below verifies one service; other bindings still need captured completion evidence.

## Protocol corrections

Numeric catalog keys are sent as numeric `product_id`; UUIDs use `product_uuid`.
Single-order polling may omit `order_uuid`, so the client retains the queried
identity and rejects a conflicting returned identity. Documented intermediate
states normalize to the existing pending state; `rejected` normalizes to the
existing rejection/refund path. Explicit error envelopes are rejected even with
HTTP 201. Missing submission IDs cannot become the string `undefined`.

Every order requires an HTTPS feedback URL and a unique reference. Callback data
is untrusted; authenticated order reads remain authoritative. Placement has no
dry run. Timeouts and invalid placement responses remain ambiguous and must not
trigger automatic POST retries.

## Verification and release boundary

The new contract tests exercise documentation-shaped responses and catalog drift;
provider, reconciliation, refund and webhook tests cover their consumers. Live GET
requests verify authentication, USD currency and current catalog parsing. They do
not prove paid completion, callbacks, native app delivery or production deployment.

This repair does not change rollout flags. Petrock still requires global enablement,
explicit tier allowlisting and async-capable clients. Preserve fixture and recovery
gates before enabling services. A localhost HTTP origin cannot provide the required
public HTTPS callback. The separate local `IMEI_HASH_SALT` gap and customer-route
service-role policy conflict remain release considerations.

## Live paid probes — 2026-10-25

Two orders were submitted once each using the owner-supplied IMEI. Customer prices
and customer wallet balances were not changed by these direct reseller tests.

- **1955 / blacklist / USD 0.04:** terminal `rejected`, replay
  `Unable to check blacklist status.` The account returned to its pre-order
  balance, consistent with the supplier refund email. This is not a blacklist
  finding about the device. Normalize it to a provider failure with an error refund.
- **1954 / Apple model, color, storage, FMI / USD 0.05:** terminal `success`
  after approximately 42 seconds. Replay reported **iPhone 17 Pro Max 512GB
  Silver**, **Color: Silver**, **Find My iPhone: ON**. Observed net reseller debit:
  USD 0.05. No device image URL was returned. The catalog image is a generic
  Apple service icon, not a device photo. This probe does not enable product 1954
  as a customer tier or establish blacklist status.

The pending Apple response had `replay: null` and `date_completed: null`.
The client now accepts that pending response; completed success still requires
nonblank replay. Regression tests cover both captured outcomes. Partial Apple
reports no longer infer `Clean` without blacklist evidence; unknown status uses
caution colors on web and mobile. Unmapped device models use the existing phone
icon instead of the malformed Apple fallback URL, keeping reserved image geometry.

## Completion notifications

DHRU documents per-order `feedback_url` notifications for terminal success and
rejection, carrying `reference_id`, `order_id`, `status`, and base64 `replay`.
It expects HTTP 200 acknowledgement. No cryptographic signature is documented;
verify final state with authenticated GET order before fulfillment or refunds.

Existing endpoints:

- `/api/webhooks/petrock/imei/[token]`: bounded callback capture and metadata event;
  currently does not immediately trigger info-check reconciliation.
- `/api/webhooks/petrock/remediation/[token]`: callback capture plus an immediate
  `next_poll_at` nudge for open orders. Reconciliation supports remediation notifications.

Both local endpoints now acknowledge HTTP 200. A future info-check callback
consumer can enqueue an authenticated status fetch and then send completion
notifications; retain fallback reconciliation for missed callbacks. This work has
not added that consumer or proved callback delivery. Direct probes used random
unassociated callback tokens, so they do not establish an application event record,
customer notification, or an end-to-end wallet flow. Nothing here is deployed.

Remediation assessment and house-check submission require explicit clean-blacklist and locked-SIM evidence. Unknown evidence is suppressed before any provider call; rejected product 1955 is not a house-check binding.
