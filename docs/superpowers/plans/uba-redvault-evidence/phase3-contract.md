# Phase 3 initialize adapter contract

- Input authority is the scoped storefront order JWT plus persisted order/application rows; client flags, amount, currency, merchant, quote hash, and bank filters are ignored.
- The reserve RPC locks the REDVAULT application and order, requires Ogabassey ownership, pending/unpaid state, and a configured runtime bank code, then returns one immutable attempt keyed by application and quote hash.
- A newly created attempt is persisted before provider initialization. An `indeterminate` attempt is returned for reconciliation and never initializes a second hosted session.
- The runtime remains disabled by default. The existing orders and initialize routes return `REDVAULT_UNAVAILABLE` before order persistence or provider initialization while availability is false. No provider verification response can approve an attempt; captured results are held pending the separately reviewed eligibility-evidence contract.

## RPC contract

`reserve_storefront_redvault_payment_attempt(p_order_id uuid)` is authenticated-only and requires the scoped `storefront_order_context` JWT, matching scoped merchant ID, customer email, and user ID. It returns one row:

`attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text`.

The row is derived only from private application/runtime and persisted order state. The client supplies only `p_order_id`. `bank_code` is server-to-server initialization input and must never become a client checkout filter. `authorization_url` is null until the provider result is durably recorded, then is reused as the only initialized retry result.

## Availability contract

The server-facing availability result is `{ available: false, reason: 'provider_evidence_unavailable' }` unless the immutable Ogabassey merchant, protected runtime configuration, provider-ready evidence record, and reviewed provider bank lookup are all present. `runtime.enabled` by itself never authorizes Paystack initialization. The existing orders and initialize routes use this result before any REDVAULT order or hosted-checkout side effect; clients must not display or invoke a payment action based on local configuration.

## Persisted initialization contract

`get_order_payment_snapshot` returns the persisted `payment_method`, so a REDVAULT order cannot enter a generic gateway branch. A client requests REDVAULT explicitly, but the route uses the snapshot plus the customer-scoped `reserve_storefront_redvault_payment_attempt` RPC as the authority for merchant, order, amount, currency, reference, and bank filter.

Conversely, a REDVAULT request for an ordinary order is rejected. The request body cannot use the REDVAULT provider path to choose a merchant, amount, order type, currency, or alternate gateway. The protected order-draft response is read through the authenticated `get_storefront_redvault_checkout_summary` RPC only after proof attachment; it never falls back to quote input or client arithmetic.

## Frozen checkout response contract

The `POST /api/orders` REDVAULT success response is exactly snake_case on the wire. Web and mobile must consume these field names as written; there is no camelCase alias:

```json
{
  "order": {
    "id": "uuid",
    "total": 117.5,
    "currency": "NGN",
    "tracking_token": "string-or-null",
    "payment_method": "uba_redvault",
    "payment_status": "unpaid"
  },
  "redvault": {
    "status": "pending",
    "quote": {
      "product_subtotal_kobo": 11000,
      "eligible_subtotal_kobo": 10000,
      "ineligible_subtotal_kobo": 1000,
      "discount_kobo": 500,
      "tax_kobo": 750,
      "shipping_kobo": 500,
      "gift_wrapping_kobo": 0,
      "payable_kobo": 11750,
      "mixed_basket": true
    }
  }
}
```

`order.total`, `order.currency`, and `order.tracking_token` come from the persisted order. `product_subtotal_kobo` comes from the persisted protected quote; eligible and discount values come from the protected application; tax, shipping, gift wrapping, and payable values come from persisted order fields. `ineligible_subtotal_kobo` and `mixed_basket` are calculated inside the RPC from the persisted protected quote/application values. `payable_kobo` must equal the persisted `order.total` converted to kobo. This response is a checkout display contract, not approval or settlement evidence.

The scoped adapter persists a `created` attempt before calling Paystack, then atomically claims it as `initializing`. Only the successful claimer can call the provider; concurrent callers receive reconciliation-required or the persisted initialized URL. The claimer records only the hosted authorization URL after a successful response and changes an uncertain result to `indeterminate`. No provider response body or credential is persisted or returned.

REDVAULT initialization accepts only the explicit `paystack` gateway and no `payment_type`; bank transfer/DVA and alternate gateways are rejected rather than silently rewritten. The provider request uses the merchant subaccount only inside this disabled path. Before activation, Paystack and UBA must provide reviewed settlement evidence that a capture which remains `captured_held` cannot settle, credit, or otherwise release merchant value through that subaccount. A ledger hold or the absence of an order-paid transition is not proof that bank settlement is blocked.
