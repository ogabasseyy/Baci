# Shipping destination coordinate loss

## Incident and source

The current booking alert is:

> The saved shipping quote no longer matches this order destination. Please get a new quote before shipping.

`assertQuoteReceiverMatchesOrder` requires matching, complete coordinate pairs
when either destination contains a pin. Checkout quote requests include the pin,
but `orderCreateSchema` previously stripped both coordinates. Checkout quote
enrichment copied country and postal fields without copying the validated pin.
The order could therefore pay for a pinned quote while saving an unpinned
destination. Refreshing the quote copies the same receiver and repeats the
destination mismatch.

The earlier reservation and quote-proof migrations address separate SQL errors.
The quote refreshed successfully after those migrations; it is the destination
guard that rejects the subsequent booking.

## Prevention in this patch

- Validate optional coordinates as a complete, finite numeric pair within range.
- Preserve coordinates through order input parsing.
- After quote merchant, provider, fee, item, expiry and destination-text checks,
  allow **new order creation only** to adopt its validated checkout quote's pin.
- Apply validated pin adoption to supported carrier quotes, including GIGL and
  TOPSHIP, with the same merchant, provider, fee, item and destination checks.
- Reject malformed or conflicting pins. Keep existing matching order pins.
- Existing order reuse never adopts missing coordinates from matching address
  text alone. A confirmed same-key idempotent replay re-derives the first
  attempt's validated quote pin in memory only (the stored order row is never
  rewritten). The booking guard stays intact.

Unchanged schema helpers were extracted to keep the edited schemas below the
repository's 300-line limit. Public schema imports remain compatible.

## Existing-order recovery remains a separate step

This patch does not repair existing orders, generate live carrier quotes, book
shipments or change payment funding. No production writes were performed.

For the reported order, the read-only investigation found no `checkout_sessions`
row linked by `order_id`. The only quote attestation linked to the order was the
refreshed quote. That evidence does not establish which pin the customer
originally accepted. Additional immutable checkout provenance may exist elsewhere;
it must be verified before considering automatic recovery.

A safe recovery must follow one of these paths:

1. Recover a complete, valid pair from original checkout provenance, bound to
   this order and merchant, with unchanged destination text/version and both
   order coordinates absent. Require compare-and-set on the inspected order
   version, selected quote and address; write a scoped audit record atomically.
2. If that provenance is unavailable, require explicit destination/pin
   confirmation. Preview a new quote from the confirmed destination and
   authoritative order items/sender before changing the order.

Neither path may overwrite partial or conflicting pins automatically. Preserve
`customer_checkout` funding and retained shipping economics. A changed tariff
must be shown for explicit confirmation; any extra funding/refund requires its
own supported payment step. Quote refresh/confirmation must never auto-book.
Do not route this paid order through a wallet quote flow that changes its funding.

## Minimal production diagnostic query

Run read-only with the scoped order and merchant parameters. It returns no
customer address text, contact details or coordinate values.

```sql
SELECT o.id, o.updated_at, o.shipping_status, o.payment_status,
       o.shipping_funding_source,
       o.shipment_id IS NOT NULL AS has_shipment,
       o.tracking_number IS NOT NULL AS has_tracking,
       o.shipping_address ? 'latitude' AS order_has_latitude,
       o.shipping_address ? 'longitude' AS order_has_longitude,
       q.id AS quote_id, q.created_at, q.expires_at,
       (q.quote_request->'receiver') ? 'latitude' AS quote_has_latitude,
       (q.quote_request->'receiver') ? 'longitude' AS quote_has_longitude,
       EXISTS (SELECT 1 FROM public.shipping_quote_attestations a
               WHERE a.quote_id = q.id AND a.order_id = o.id
                 AND a.merchant_id = o.merchant_id) AS order_attested_quote,
       EXISTS (SELECT 1 FROM public.checkout_sessions c
               WHERE c.order_id = o.id) AS linked_checkout_session
FROM public.orders o
LEFT JOIN public.shipping_quotes q
  ON q.id = o.selected_quote_id AND q.merchant_id = o.merchant_id
WHERE o.id = :order_id AND o.merchant_id = :merchant_id;
```

## Regression checks

The regression suite exercises real order parsing, checkout quote enrichment and
the booking destination guard together. It covers missing, partial, malformed,
out-of-range, zero, conflicting and existing pins, as well as changed address
text. Existing checkout quote validation, order API, order reuse and operation
schema suites also run. No test calls a live carrier or writes production data.

## Source-contract receipts

The order route only adds its existing idempotent-replay decision to quote
validation. Its frozen event-boundary receipt was updated after verifying that
tenant authorization, payments, notifications and privileged-client authority
are unchanged. The storefront inventory was regenerated through its existing
source-bound generator; all 573 route classifications remain unchanged. Neither
validator was relaxed. Independent operation schemas now have focused modules
and colocated tests, with `orders.ts` retaining its compatibility exports.

## Replay and reuse corrections

Both order and quote street text remove only their own exact city/state suffix
before comparison; different street/building or locality text still fails.
Reuse validation retains the stored complete pin and rejects malformed pairs.
Quote-less idempotency hashes include complete coordinates, including zero,
so a coordinate-only retry cannot silently reuse a different destination.
No-pin legacy hashes and selected-quote hashes retain their original bytes.
Historical quote-less retries whose pins were stripped before this prevention
change cannot prove the original pin and fail closed; no compatibility fallback
discards coordinates or weakens the booking destination guard.
