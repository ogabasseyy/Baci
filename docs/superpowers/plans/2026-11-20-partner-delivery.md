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

The quote stores the merchant payable separately from the buyer total. The pilot supports `base_plus_delivery` only when explicitly configured through `CROSSREM_SETTLEMENT_BASIS` after both parties agree. Set this before issuing a quote for a paid pilot order. Under that policy merchant payable is the base merchandise amount, Baci VAT where applicable, and delivery. The buyer total also includes the configured catalog markup. Quotes issued without the policy must be replaced before payment. A trusted verifier records the actual payout allocation against the stored payable after capture verification. It must identify the authorized settlement account and a unique order allocation within the payout. A capture or settlement receipt alone cannot create an order or authorize a shipment.

### Current order and tracking boundary

The internal acceptance transaction requires verified capture and merchant settlement. The current implementation admits an exact NGN buyer capture and an exact NGN merchant allocation. FX and separately collected fees need an agreed policy before order acceptance. The Baci order writer requires a recipient email in addition to name and phone. A receipt can still record incomplete contact details for reconciliation after a payment attempt.

On acceptance, Baci returns the same order ID on every identical submission retry. The order has a paid ledger entry, and its stored shipping address comes from the quote. The carrier quote remains unbound until the booking path establishes merchant-wallet funding and can check the current rate. Partners poll `GET /api/partners/v1/orders/{orderId}` for shipping status and waybill. The read returns only orders accepted through the same partner connection.

For a settled partner order, the existing merchant fulfillment flow must bind an attested, unused domestic GIG door quote to the order and fund it from the merchant shipping wallet. The database rejects a quote that exceeds the previously settled delivery fee. Baci reports a rate increase for reconciliation and keeps the carrier booking on hold. The existing shipment claim and wallet reservation continue to protect the actual booking.

### Draft consumer guide and evidence ingress

The [delivery API quickstart](../../partners/delivery-api-quickstart.md) documents the supported calls. The internal reconciliation route is for Baci’s authorized verifier only. It accepts normalized capture and settlement evidence using a separate connection-scoped verifier credential. Do not provision that credential for a partner or enable a live verifier until its payment and payout evidence sources are confirmed. The fixture checks exercise complete acceptance and a price-drift hold. Carrier booking and tracking still need verification against the real shipment path.

### GIG contract check

The existing Baci adapter maps to GIG’s documented domestic price (`/price/v3`), pre-shipment capture (`/capture/preshipment`), and waybill tracking (`/track/mobileShipment`). Keep those calls behind Baci’s quote, fulfillment, and order-status services, so future partners can use the same API regardless of the carrier. Verify a domestic quote, the merchant-funded booking, and retrieval of the same waybill through Baci’s order endpoint using authorized GIG credentials and a controlled shipment. Confirm the hosted catalog’s `200` and `304` behavior at the agreed poll interval before enabling partner sync. [GIG API documentation](https://dev-thirdpartynode.theagilitysystems.com/docs/)

### Local storefront writer check

Run `python3 supabase/tests/run_partner_order_real_storefront_writer.py` with PostgreSQL binaries on `PATH`. It creates an isolated database with a reduced schema, loads Baci's actual storefront order writer, and checks paid acceptance, replay, exact prices, and both product and offer inventory. The same SQL suite is registered for the complete Supabase schema replay in CI. The local check does not contact the carrier or payment provider.

The internal verifier receives `409 CAPTURE_EVIDENCE_CONFLICT` for a capture mismatch or duplicate, `404` for an inaccessible submission, and `429` with `Retry-After` when it hits the reconciliation limit. These responses belong to the internal ingress and do not appear in the partner API contract.
