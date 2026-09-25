# Storefront checkout funnel

The checkout funnel is split at the point where customer intent changes. An
invoice request is a successful document-generation outcome, not a completed
payment. A card, bank-transfer, crypto, or installment order is only a payment
conversion after the provider or server confirms it.

## Event contract

The canonical events are defined in
`packages/shared/src/contracts/checkout-funnel-analytics.ts` and are emitted by
both the web storefront and mobile storefront.

| Event | Meaning | Required distinguishing properties |
| --- | --- | --- |
| `checkout_started` | The customer enters checkout with items | `item_count`, `value`, `currency` |
| `checkout_step_completed` | A validated checkout step is completed | `checkout_step` |
| `checkout_payment_method_selected` | A payment instrument or intent is selected | `payment_method`, `payment_intent` |
| `order_created` | The server creates the order | `order_id`, `payment_status`, `payment_method`, `payment_intent`, `value` |
| `invoice_generated` | The proforma invoice path completes | `order_id`, `payment_intent=proforma_invoice`, `payment_status=unpaid` |
| `payment_started` | A provider or bank-transfer flow is opened | `order_id`, `payment_method`, `value` |
| `payment_completed` | A provider/server confirmation is received | `order_id`, `payment_status=paid`, `payment_method` |
| `payment_failed` | A payment attempt fails after an order exists, or a checkout payment error is reported | `payment_method`, `reason` |

Every event carries `checkout_flow=storefront`, `event_version=1`, `source`, and
`channel`. The platform adapter adds `app_surface` (`web` or
`mobile-storefront`), release version, and the normal PostHog identity context.
Customer email, phone, address, payment credentials, and provider payloads are
not funnel properties.

## Recommended PostHog funnels

Create separate sequential funnels so mutually exclusive outcomes are not
forced through one misleading final step:

1. **Order creation:** `checkout_started` → `checkout_payment_method_selected` → `order_created`.
2. **Proforma invoice:** the same first three steps, filtered to
   `payment_intent=proforma_invoice`, then `invoice_generated`.
3. **Paid checkout:** the same first three steps, filtered to
   `payment_intent=pay_now` or `installments`, then `payment_started` →
   `payment_completed`.

Break down each funnel by `app_surface`, `channel`, `$os`, and release version.
Use the payment-method step for intent analysis, and the order-created step for
unique order conversion; payment-method selection can repeat and should not be
treated as an order count. Review absolute and relative drop-off, conversion
time, and incomplete recent periods separately. For payment completion, use the
first occurrence matching the order/payment filter and deduplicate by
`order_id`.

This follows the structure recommended by the primary product analytics
guidance: start with the first meaningful event, keep only required sequential
steps, use properties for breakdowns and attribution, and treat the final
success event as the actual outcome. See [PostHog funnels](https://posthog.com/docs/product-analytics/funnels),
[PostHog event naming and ordering](https://posthog.com/docs/product-analytics/best-practices),
and [PostHog schema management](https://posthog.com/docs/product-analytics/schema-management).
For ecommerce terminology, the paid path also follows the standard
`begin_checkout` → payment information → purchase shape described in [Google
Analytics ecommerce events](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce).

## Interpretation notes

- `order_created` measures checkout intent that reached the server. It does not
  prove that money settled.
- `invoice_generated` is the intended success metric for the proforma path.
  “Payment completed” must not be added to that branch merely because the
  invoice page loaded.
- `payment_completed` is emitted only from verified provider completion or a
  server-confirmed paid order. Reloads of the web confirmation page are
  session-deduplicated by order.
- Existing title-case ecommerce events remain for historical reports. New
  funnels should use the lowercase, versioned contract above; do not mix the
  legacy and canonical events in one conversion definition.
