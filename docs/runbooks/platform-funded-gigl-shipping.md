# Platform-funded GIG shipping (owner-only "Baci pays")

Flag table: `private.platform_funded_gigl_merchants` (postgres/SQL editor only).

Enable: `INSERT INTO private.platform_funded_gigl_merchants (merchant_id) VALUES ('<merchant uuid>') ON CONFLICT (merchant_id) DO UPDATE SET enabled = true;`
Disable (do it when no booking is in progress; an in-flight booking that already reserved may still complete): `UPDATE private.platform_funded_gigl_merchants SET enabled = false WHERE merchant_id = '<merchant uuid>';`

## Periodic review (spend visibility)

Run these as postgres in the SQL editor (the flag table is unreadable to every API role).

```sql
-- Actual GIG exposure: provider_cost on submitted charges only. charged_amount
-- is the public quote (it includes platform_margin) and reserved/refunded rows
-- never reached the provider, so neither is spend.
SELECT merchant_id, status, count(*), sum(provider_cost)
FROM public.merchant_shipping_charges
WHERE funding_source = 'platform' AND created_at > now() - interval '30 days'
  AND status IN ('provider_submitting','booked','needs_reconciliation')
GROUP BY merchant_id, status;
SELECT merchant_id, enabled FROM private.platform_funded_gigl_merchants;
```

## GIG cancels a booked platform shipment

The cancellation guard raises `active_merchant_shipping_charge` (55P03) and the
order stays blocked. No wallet was debited, so nothing to refund. Find them:

```sql
SELECT order_id, status FROM public.merchant_shipping_charges
WHERE funding_source = 'platform' AND status IN ('booked','needs_reconciliation');
```

Confirm cancellation with GIG, then set the charge as postgres: `UPDATE public.merchant_shipping_charges SET status = 'refunded', failure_code = 'PROVIDER_CANCELLED_MANUAL', refunded_at = now(), updated_at = now() WHERE id = '<charge id>' AND funding_source = 'platform' AND status IN ('booked','needs_reconciliation');` Run the charge, shipment and order updates below together in ONE transaction (`BEGIN; ... COMMIT;`), only after GIG's written confirmation, and check the row count is 1 before committing.
(no wallet movement; the CHECK forbids wallet transaction ids on platform charges).

### Full cleanup and evidence (required before the UPDATE)

1. Obtain written/portal confirmation from GIG that the waybill (`shipments.tracking_number`) is cancelled, and record it on the ticket.
2. If GIG may still deliver, do NOT mark refunded; reconcile with GIG first.
3. After the charge UPDATE, check the order: `shipment_id`, `tracking_number`, `shipping_status` and the `shipments` row must reflect the cancellation (set the shipment `status = 'cancelled'`), and clear any `shipment_booking_lock_token`.
4. Re-quote the order in the admin app if it must ship again.

Pre-check (must return exactly one row; proves the three ids belong together):

```sql
SELECT c.id AS charge_id, c.shipment_id, c.order_id, o.shipping_status
FROM public.merchant_shipping_charges c
JOIN public.shipments s ON s.id = c.shipment_id AND s.order_id = c.order_id
JOIN public.orders o ON o.id = c.order_id AND o.shipment_id = s.id
WHERE c.id = '<charge id>' AND c.funding_source = 'platform';
```

Cancelling the shipment makes the tracking trigger set the order's `shipping_status` to `cancelled`, which blocks re-quoting (409), so the order update below restores it to `processing`. Shipping economics are left as they are; re-quote in the admin app to re-book.

Copy-pasteable transaction (replace the placeholders; every statement must report 1 row):

```sql
BEGIN;
UPDATE public.merchant_shipping_charges
SET status = 'refunded', failure_code = 'PROVIDER_CANCELLED_MANUAL',
    refunded_at = now(), updated_at = now()
WHERE id = '<charge id>' AND funding_source = 'platform'
  AND order_id = '<order id>' AND shipment_id = '<shipment id>'
  AND status IN ('booked','needs_reconciliation');
UPDATE public.shipments SET status = 'cancelled', cancelled_at = now(), updated_at = now()
WHERE id = '<shipment id>' AND order_id = '<order id>';
UPDATE public.orders
SET shipment_id = NULL, tracking_number = NULL,
    shipment_booking_lock_token = NULL, shipment_booking_started_at = NULL,
    shipping_status = 'processing', updated_at = now()
WHERE id = '<order id>' AND shipment_id = '<shipment id>';
-- COMMIT only if all three updates affected exactly one row; otherwise ROLLBACK.
```

Before COMMIT, a second person must review the pre-check output and the ticket link holding GIG's written confirmation.
