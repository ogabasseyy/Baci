# Baci partner delivery API

The Ogabassey catalog feed is live. Delivery quotes, paid-order intake, and tracking are pre-live for CrossRem. Wait for Baci to confirm live GIG booking and the payment and payout evidence workflow before collecting payment through this integration. See the [OpenAPI contract](delivery-api.openapi.yaml) for schemas and status codes.

## Before making requests

Use the API base URL Baci gives your team. For the Ogabassey connection, the catalog base URL is `https://ogabassey.com/api/partners/v1`. Call from your backend over HTTPS with `Authorization: Bearer <credential>`. Keep credentials out of browser and mobile clients. Baci configures the catalog, quote, and order permissions for your merchant connection. Amounts are integer minor units of the stated currency. NGN uses kobo.

## 1. Refresh the catalog

Call `GET /catalog` with your read-only credential. Keep each product's `listing_id` as the source key across imports. Use `price_minor` as the listed selling price. For Ogabassey–CrossRem, that price excludes delivery and optional device protection.

Store the last complete catalog and its `ETag`. On subsequent requests send `If-None-Match` with that value. A `200` contains the entire new catalog. Validate it before replacing the old one. A `304` means your existing copy is current. Keep your last good copy on errors, including `503`.
Catalog reads allow up to 120 requests per connection per minute, including conditional requests. If you receive `429`, wait for the interval in `Retry-After` before polling again.

## 2. Quote delivery before collecting payment

Call `POST /quotes` with the quote credential and a JSON body. The following example uses a fictional listing ID. Use the ID from your catalog import.

```json
{
  "items": [
    { "listing_id": "listing-one", "quantity": 2 }
  ],
  "destination": {
    "address_line1": "10 Example Street",
    "city": "Ikeja",
    "state": "Lagos",
    "country_code": "NG"
  }
}
```

A `201` returns `quote_id`, `currency`, the selected service and delivery estimate, line prices, `subtotal_minor`, `tax_minor`, `delivery_minor`, `total_minor`, and `expires_at`. The pilot offers domestic door delivery and sets expiry to the earlier of ten minutes after quoting or the validity limit returned by the shipping adapter. Show `total_minor` before payment. It includes the item subtotal, Baci VAT on the underlying merchant merchandise where applicable, and delivery. Get a new quote before charging if the order or address changes, or if the quote expires. Baci checks requested quantities before issuing the quote. A quote does not reserve stock.

If Baci returns `ADDRESS_UNSERVICEABLE`, `CARRIER_UNAVAILABLE`, or `QUOTE_UNAVAILABLE`, Baci has issued no payable quote. A missing settlement policy or an unsupported merchant origin also returns `QUOTE_UNAVAILABLE`. Keep checkout on hold. Retry after a temporary outage, and share the request ID with Baci support if the error persists.

Keep one active quote per purchase and reuse its ID while it remains valid. A quote request can be retried after a timeout **before** charging the buyer. A quote retry can issue a new quote ID and never charges or reserves stock. Once charging starts, keep the quote ID tied to that payment attempt. If the payment outcome is unclear, check the original attempt before requesting a replacement quote or charge.

## 3. Submit the purchase

After payment captures, call `POST /orders` using the order credential and an `Idempotency-Key` that matches `^[A-Za-z0-9_.:-]{16,128}$`. A UUID works. Keep that key and the original body for retries. Send the original quote ID and the same partner order reference each time. The paid quote fixes the delivery destination for fulfillment. If the destination changes, reconcile the original payment with Baci before starting a new purchase. Include the recipient’s name, phone number, and email.

```json
{
  "quote_id": "20000000-0000-4000-8000-000000000001",
  "partner_order_id": "example-order-reference",
  "recipient": {
    "name": "Example Recipient",
    "phone": "+2348000000000",
    "email": "recipient@example.invalid"
  },
  "payment": {
    "source": "example-provider",
    "reference": "example-capture-reference",
    "amount_minor": 171200,
    "currency": "NGN"
  }
}
```

Submit the verified buyer amount in NGN using your configured provider source. Baci verifies the capture and settlement through the agreed evidence source. A `202` means Baci has recorded the submission. If payment captured before expiry, submit its original reference and quote even after expiry. Baci checks the verified capture timestamp against the quote window. If the capture itself occurred at or after expiry, Baci rejects that evidence and the submission remains pending verification. Reconcile the original payment with the agreed refund owner before attempting a replacement purchase. An accepted replay returns `200` with the original `order_id`. An incompatible reuse of an order reference, quote, or idempotency key returns `409 ORDER_CONFLICT`. After a timeout, check submission status or retry the original request. Do not collect payment again to recover a timed-out submission.

Unsubmitted quotes remain available for late paid-order intake for seven days after expiry. Submit promptly after payment. If an older paid order returns `404 QUOTE_NOT_FOUND`, reconcile the original payment with the agreed refund owner before collecting a replacement payment.

Submissions that still lack a verified capture are removed after both the quote and the submission are at least seven days old. Baci retains verified capture and settlement records for reconciliation.

## 4. Read status and tracking

Call `GET /order-submissions?partner_order_id=example-order-reference`. A receipt reports `pending_verification`, `payment_verified`, `settlement_verified`, `review_required`, or `accepted`. The `accepted` receipt includes `order_id`. The merchant moves the order to processing when it is ready for dispatch. A `review_required` receipt includes a `review_reason`. Retain the original payment and order references. A settlement review can clear when Baci verifies a corrected payout allocation. An order review means the original purchase needs a disposition before a replacement purchase can be attempted.

Send exactly one `partner_order_id` parameter. Baci rejects duplicate references and additional query parameters.

Call `GET /orders/{orderId}` with that ID. Baci returns the payment status, shipping status, and tracking provider and waybill once available. Tracking is `null` until a waybill is recorded. Only the same merchant–partner connection can read an order.
If either status is `unknown`, keep polling and wait for a recognized value before changing the order's state in your system.

For the CrossRem pilot, Baci uses the merchant wallet to book the GIG service originally quoted. If the current service or delivery amount differs, reconcile the difference before booking.

For temporary failures, keep the last known status and retry with backoff. For `500 ORDER_RESPONSE_INVALID`, retain the response's `request_id` for support and check the original order reference before resubmitting. Keep recipient and payment data out of logs. A delivery exception should be reconciled against the shipment before a refund or repeat booking is initiated.
