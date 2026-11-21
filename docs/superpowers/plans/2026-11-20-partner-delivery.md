# Baci Partner Delivery Implementation Plan

**Goal** — A partner can read Baci's documentation, import a merchant's catalog, quote delivery before checkout, submit a paid order once, and retrieve its fulfillment status.

**Architecture** — Use versioned HTTP contracts under `/api/partners/v1`. Resolve the merchant, permissions, carrier, pricing, and settlement policy from the authenticated partner connection. Reuse Baci's catalog, GIG, order, inventory, and fulfillment services. Ogabassey is the first merchant and CrossRem is the first delivery integration.

**Tech stack** — Next.js route handlers, Zod schemas, and Supabase. Publish OpenAPI and a short integration guide with examples that are checked against the deployed implementation.

**Source** — CrossRem's technical email “Ogabassey Store Integration & Product Feed Update” and the 10 November Ogabassey × CrossRem integration draft.

## Build and verify

1. **Partner access and catalog.** Preserve the deployed catalog endpoint and its stable listing IDs, prices, protection flag, and ETag behavior. Add an authenticated connection for delivery operations. Resolve merchant and scopes from the credential and keep the current read-only feed credential read-only. Validate cross-merchant and cross-scope access with two fixture connections.

2. **Delivery quote.** Add `POST /api/partners/v1/quotes` with catalog listing IDs, quantities, and a structured address. Resolve listing identity, merchandise values, dispatch origin, parcel data, and carrier configuration inside Baci. Call the configured carrier through Baci’s shipping service and persist the quote under the authenticated connection. Keep the provider rate ID and parcel snapshot for booking. Derive the parcel from merchant product metadata using Baci’s existing weight conversion and verify that the quote and booking use the same inputs. Return a quote ID, delivery fee and total in NGN minor units, service, estimate, and expiry. Set the public expiry using the earlier of the partner connection’s quote validity and the expiry returned by Baci’s shipping adapter. GIG domestic quotes currently receive an adapter-generated one-hour expiry. Treat that value as a Baci validity limit. Require a fresh quote when address, service, or contents change. Test expiration, retired listings, address rejection, and carrier unavailability. An unavailable quote must never appear as free delivery.

3. **Paid orders.** Add `POST /api/partners/v1/orders` and an exact lookup by the connection and partner order reference. Bind intake to the stored quote and a verifiable payment reference. Store a durable receipt before acknowledging pending verification. An accepted submission must create the Baci order and claim inventory atomically. An identical retry returns the original result. A conflicting retry fails. Test duplicate concurrent requests, price and payment mismatches, out-of-stock handling, and recovery after a lost response. Release dispatch only after the agreed settlement and Baci shipping-funding conditions are met.

4. **Fulfillment and tracking.** Add `GET /api/partners/v1/orders/{order_id}`, scoped to the connection, to return status, carrier, and waybill when assigned. Use the existing Baci shipment state. If callbacks are part of the agreed interface, use signed events with stable event IDs and retry support. Verify that another connection cannot access the order and that duplicate or delayed events cannot regress status. Document failed delivery, redelivery, and refund responsibilities.

5. **Developer documentation and release proof.** Publish a reusable quickstart, the versioned OpenAPI description, request and response examples, error codes, retry rules, and an onboarding checklist. Document endpoint capabilities by connection. Put CrossRem's pricing, GIG service, address fields, and settlement choices in its onboarding notes. Exercise the contract with Baci-controlled fixtures through quote, accepted order, fulfillment, tracking, and a rejected paid submission. Verify the deployed contract and live feed before preparing the partner handoff.

## Open inputs for CrossRem paid orders

- Which authoritative payment evidence Baci can verify, and which identifier links it to the specific quote and purchase.
- Which amounts CrossRem remits, when they settle, who funds the carrier charge, and who handles failed-delivery or buyer refunds.
- Whether order status polling meets their needs or they also want signed callbacks.

Quote development, Baci-controlled tests, and documentation can proceed independently of these decisions. The end-to-end payment and release checks need agreed payment evidence and settlement terms.

### Current settlement boundary

The quote stores the merchant payable separately from the buyer total. The pilot supports `base_plus_delivery` only when explicitly configured through `CROSSREM_SETTLEMENT_BASIS` after both parties agree. Set this before issuing a quote for a paid pilot order. Under that policy merchant payable is the base merchandise amount, Baci VAT where applicable, and delivery. The buyer total also includes the configured catalog markup. Baci returns `503 QUOTE_UNAVAILABLE` until this policy is configured. The order API accepts NGN for the buyer payment. A trusted verifier records the actual payout allocation against the stored payable after capture verification. It must identify the authorized settlement account and a unique order allocation within the payout. A capture or settlement receipt alone cannot create an order or authorize a shipment.

### Current order and tracking boundary

The internal acceptance transaction requires verified capture and merchant settlement. The current implementation admits an exact NGN buyer capture and an exact NGN merchant allocation. FX and separately collected fees need an agreed policy before order acceptance. The Baci order writer requires a recipient email in addition to name and phone. The order API requires the recipient email at intake. The API records late delivery of a paid-order submission. Acceptance requires the verified capture to have occurred within the original quote window.

On acceptance, Baci returns the same order ID on every identical submission retry. The order has a paid ledger entry, and its stored shipping address comes from the quote. The carrier quote remains unbound until the booking path establishes merchant-wallet funding and can check the current rate. Partners poll `GET /api/partners/v1/orders/{orderId}` for shipping status and waybill. The read returns only orders accepted through the same partner connection.

Once the merchant moves a settled partner order to processing, the existing fulfillment flow must bind an attested, unused domestic GIG door quote to the order and fund it from the merchant shipping wallet. The destination and GIG service must match the paid quote, and the rate must match the settled delivery fee to the kobo. Replacement quotes also match the paid pickup origin and parcel. A changed origin or parcel requires reconciliation before booking. Booking uses the bound pickup fields and current validated sender contacts. Baci holds booking if the rate changes in either direction. The pilot requires that match until the merchant and partner agree who pays or receives a delivery rate difference. The existing shipment claim and wallet reservation continue to protect the actual booking. The shipping guard runs after the existing economics trigger so it checks the final funding state.

### Draft consumer guide and evidence ingress

The [delivery API quickstart](../../partners/delivery-api-quickstart.md) documents the supported calls. The internal reconciliation route is for Baci’s authorized verifier only. It accepts normalized capture and settlement evidence using a separate connection-scoped verifier credential. After verifying the credential, Baci calls the database with the existing short-lived, merchant-scoped storefront order token and a proof bound to the reconciliation request. Do not provision that credential for a partner or enable a live verifier until its payment and payout evidence sources are confirmed. The fixture checks exercise complete acceptance and a price-drift hold. Carrier booking and tracking still need verification against the real shipment path.

#### Internal verifier responses

`POST /api/internal/partner-order-reconciliation` takes the submission ID, quote ID, partner order reference, verified capture, and optional verified settlement. The verifier supplies NGN minor amounts and the original provider timestamps. Success returns `receipt`, `hold_reason` and `request_id`. Errors return `error.code` and `request_id`. Partner clients use the order submission status route in the public OpenAPI contract.

| HTTP | Outcome | Verifier action |
| --- | --- | --- |
| 200 | Accepted receipt and order ID | Save the receipt. An identical retry returns the same order. |
| 202 | Verification pending or a receipt held with `SETTLEMENT_REVIEW_REQUIRED` or `ORDER_REVIEW_REQUIRED` | Use the review procedure below when `hold_reason` is set. |
| 400 | `INVALID_REQUEST` or `CAPTURE_EVIDENCE_MISMATCH` | Check the submitted evidence against the original capture and quote. |
| 404 | `NOT_FOUND` | Check credential scope and the submission reference. |
| 409 | `CAPTURE_EVIDENCE_CONFLICT` | Reconcile the existing capture claim before proceeding. |
| 409 | `CAPTURE_TIMESTAMP_AFTER_RECEIPT` | Retry only with corrected evidence verified against the provider. Replaying the same evidence will return the same conflict. |
| 409 | `SETTLEMENT_EVIDENCE_CONFLICT` | Compare the replayed payout allocation to the evidence on the accepted order. |
| 409 | `RECONCILIATION_CONFLICT` | Check the submission receipt and existing evidence before retrying. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce the evidence payload to the normalized fields. |
| 429 | `RATE_LIMITED` | Wait for `Retry-After`. |
| 500 | `RECONCILIATION_RESPONSE_INVALID` | Escalate with the request ID and check the current receipt. The database may have committed before producing the invalid response. |
| 503 | `RECONCILIATION_UNAVAILABLE` | Check the receipt and retry the same evidence with backoff after service recovery. |

Before acceptance, an allocation conflict returns `202 SETTLEMENT_REVIEW_REQUIRED` so the capture remains available while the payout is reconciled. After acceptance, conflicting replay evidence returns `409 SETTLEMENT_EVIDENCE_CONFLICT` and the accepted receipt remains available.

### GIG contract check

The adapter generates the Baci UUID used as the partner `quote_id` locally. The GIG rate identifier is stored separately as `provider_rate_id`.

The existing Baci adapter maps to GIG’s documented domestic price (`/price/v3`), pre-shipment capture (`/capture/preshipment`), and waybill tracking (`/track/mobileShipment`). Keep those calls behind Baci’s quote, fulfillment, and order-status services, so future partners can use the same API regardless of the carrier. Verify a domestic quote, the merchant-funded booking, and retrieval of the same waybill through Baci’s order endpoint using authorized GIG credentials and a controlled shipment. Confirm the hosted catalog’s `200` and `304` behavior at the agreed poll interval before enabling partner sync. [GIG API documentation](https://dev-thirdpartynode.theagilitysystems.com/docs/)

### Local storefront writer check

Run `python3 supabase/tests/run_partner_order_real_storefront_writer.py` with PostgreSQL binaries on `PATH`. It creates an isolated database with a reduced schema, loads Baci's actual storefront order writer, and checks paid acceptance, replay, exact prices, and both product and offer inventory. The same SQL suite is registered for the complete Supabase schema replay in CI. The local check does not contact the carrier or payment provider.

### Provision another merchant connection

Register a server-side connection profile with a unique connection ID, the merchant ID, and separate credentials for catalog, quotes, orders, and any Baci-operated evidence verifier. Supply the merchant's catalog loader, its versioned snapshot reader, and the supported delivery and settlement policy. Namespace the snapshot and all version or lease keys by connection. The API derives the merchant from the credential. The platform proxy rate-limits API requests before the partner routes authenticate, and the routes apply a separate connection limit after authentication. Each profile provisions its own listing IDs and prices. CrossRem's six percent markup, catalog alert, and GIG configuration belong to its Ogabassey profile. The initial onboarding flow is operator-managed.

### Local API lifecycle check

Run `python3 supabase/tests/run_partner_api_lifecycle.py` with PostgreSQL and PostgREST on `PATH` and the workspace dependencies installed. It starts a disposable database and a loopback PostgREST instance, then calls the actual route handlers using Baci’s database client. It checks the feed envelope and conditional response, VAT-inclusive quote, paid-order receipt, wrong settlement hold, one accepted order and inventory decrement after reconciliation, idempotent replay, and connection-scoped tracking. It also calls the real GIG quote binder for the accepted order. The binder rejects higher and lower rates and binds the matching rate to the merchant wallet. The catalog input, carrier responses, and upstream payment evidence are fixtures. The test imports the live quote proof logic and runs the real storefront order writer on the reduced database schema.

### CrossRem payment evidence to confirm

CrossRem’s public terms name Square as a processor. Square uses the seller account’s currency for the charge and can expose that account’s payment and payout entries with authorized read access. Confirm the charge currency and account for Ogabassey, the reference that binds the charge to the Baci quote, and the source that proves the exact NGN allocation reached Ogabassey. If CrossRem charges in another currency, confirm the contractual FX rate source, conversion and rounding, fees, and payout timing before extending the verified NGN flow. An entry in a Square payout can reconcile a Square payment to that payout. Baci also needs evidence of the remittance to Ogabassey if it moves through a separate account. [CrossRem terms](https://www.crossrem.com/terms-of-service) · [Square payment currency](https://developer.squareup.com/reference/square/payments/create-payment) · [Square payout entries](https://developer.squareup.com/docs/payouts-api/list-payout-entries)

### Hosted catalog baseline on 20 November 2026

The deployed feed returned 4,496 unique listings. The authenticated full request took 2,811 ms to headers and 4,718 ms in total. At five-second smoke intervals, three conditional requests returned bodyless `304` responses in 645, 413, and 291 ms. The live Google ID and sellable-identity parity check also passed. Repeat the hosted measurement at the agreed partner interval after deploying the partner API, before enabling sync.

Before provisioning live quote credentials, confirm that the managed database has `pg_cron` and that `cron.job` contains the active hourly `partner-unclaimed-quote-expiry` job calling `private.expire_unclaimed_partner_quotes()`. Migration `20261120192100` warns when the scheduling extension is missing and fails if an installed scheduler lacks the expected job. The local retention check calls the private function directly when running without the extension.

Also verify the hourly `partner-unverified-submission-expiry` job. It removes only submissions that have no capture record and are past the seven-day window for both expiry and intake. Monitor its deletion count and review stuck verification receipts before that window closes.

Use the hourly `partner_unclaimed_quote_expiry` database log to check deletion volume. A repeated `batch_full=true` indicates that cleanup may be falling behind. Use the PostHog event `partner_tracking_status_unknown` to detect unrecognized persisted tracking statuses. The event records which status fell back to `unknown`. To identify affected partner connections, filter the application log for `Unrecognized partner tracking status` in the alert window. Use the returned `request_id` to match one response to its log entry and use `connectionId` from that entry. The aggregate event carries status flags only.

The database logs `partner_settlement_operational_error` for unavailable settlement terms or missing verified capture. The submission stays held and any verified capture is preserved for reconciliation. Partner fulfillment requires a bound merchant-wallet GIG quote before a shipment, waybill, or dispatch status can be recorded. The GIG service must match the one on the original paid quote.

### Resolve orders that require review

Use the submission ID and provider references to check the stored charge and payout evidence. For a settlement hold, submit a corrected allocation only after independently verifying the amount, currency, and destination account. For an order hold, reconcile the original charge with the agreed refund owner and record the verified disposition under the original references. A price, stock, or tax change after the original purchase leaves that submission held. Keeping the original reference held prevents a later retry from fulfilling a charge while its refund is being resolved. A replacement purchase uses a fresh quote and new references after the original charge is resolved. Use the same review process for a verified capture outside the original quote window.

The capture check uses the provider's actual capture timestamp, between quote issuance and expiry and no later than Baci's receipt of the paid submission. Validate the provider timestamp semantics and clock alignment during onboarding. Investigate a reported clock mismatch against the provider source. Preserve the original evidence and never adjust its timestamp just to pass validation.
Monitor the `Partner capture timestamp after submission receipt` warning and the `partner_settlement_timestamp_in_future` database log for provider clock discrepancies. Amount and quote validity checks continue to apply.

Before opening the paid-order flow, assign ownership for monitoring pending verification receipts and both hold reasons, verify the alert reaches that owner, and confirm who initiates and verifies refunds.
