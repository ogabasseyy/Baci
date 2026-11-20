# Baci partner delivery API

Draft for implementation verification. The Ogabassey catalog feed is live. The delivery, order, and tracking examples describe the implementation under test. See the [OpenAPI contract](delivery-api.openapi.yaml) for schemas and status codes.

## Before making requests

Use the API base URL Baci gives your team. For the Ogabassey connection, the catalog base URL is `https://ogabassey.com/api/partners/v1`. Call from your backend over HTTPS with `Authorization: Bearer <credential>`. Keep credentials out of browser and mobile clients. Baci configures the catalog, quote, and order permissions for your merchant connection. Amounts are integer minor units of the stated currency. NGN uses kobo.

## 1. Refresh the catalog

Call `GET /catalog` with your read-only credential. Keep each product's `listing_id` as the source key across imports. Use `price_minor` as the listed selling price. For Ogabassey–CrossRem, that price excludes delivery and optional device protection.

Store the last complete catalog and its `ETag`. On subsequent requests send `If-None-Match` with that value. A `200` contains the entire new catalog. Validate it before replacing the old one. A `304` means your existing copy is current. Keep your last good copy on errors, including `503`.

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

A `201` returns `quote_id`, `currency`, the selected service and delivery estimate, line prices, `subtotal_minor`, `tax_minor`, `delivery_minor`, `total_minor`, and `expires_at`. The pilot offers domestic door delivery and sets expiry to the earlier of ten minutes after quoting or the validity limit returned by the shipping adapter. Show `total_minor` before payment. It includes the item subtotal, Baci VAT on the underlying merchant merchandise where applicable, and delivery. Get a new quote if the order or address changes, or if the quote expires. A quote does not reserve stock.

If Baci returns `ADDRESS_UNSERVICEABLE` or `CARRIER_UNAVAILABLE`, the delivery fee is unavailable. Keep checkout on hold for that address or retry after a temporary outage.

## 3. Submit the purchase

After payment captures, call `POST /orders` using the order credential and an `Idempotency-Key` that matches `^[A-Za-z0-9_.:-]{16,128}$`. A UUID works. Keep that key and the original body for retries. Send the original quote ID and the same partner order reference each time. Baci uses the delivery address stored on the quote. Supply a recipient email for order acceptance.

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

Use your configured provider source. Baci verifies the capture and settlement through the agreed evidence source. A `202` means Baci has recorded the submission. An accepted replay returns `200` with the original `order_id`. An incompatible reuse of an order reference, quote, or idempotency key returns `409 ORDER_CONFLICT`. After a timeout, check submission status or retry the original request. Do not collect payment again to recover a timed-out submission.

## 4. Read status and tracking

Call `GET /order-submissions?partner_order_id=example-order-reference`. A receipt reports `pending_verification`, `payment_verified`, `settlement_verified`, `review_required`, or `accepted`. The `accepted` receipt includes `order_id`. A `review_required` receipt includes a `review_reason`. Retain the original payment and order references while Baci reviews the submission.

Call `GET /orders/{orderId}` with that ID. Baci returns the payment status, shipping status, and tracking provider and waybill once available. Tracking is `null` until a waybill is recorded. Only the same merchant–partner connection can read an order.

For temporary failures, keep the last known status and retry with backoff. Capture the response's `request_id` for support and avoid including recipient or payment data in logs. A delivery exception should be reconciled against the shipment before a refund or repeat booking is initiated.
