# Platform-funded GIG shipping (owner-only "Baci pays")

Flag table: `private.platform_funded_gigl_merchants` (postgres/SQL editor only).

Enable: `INSERT INTO private.platform_funded_gigl_merchants (merchant_id) VALUES ('<merchant uuid>') ON CONFLICT (merchant_id) DO UPDATE SET enabled = true;`
Disable: `UPDATE private.platform_funded_gigl_merchants SET enabled = false WHERE merchant_id = '<merchant uuid>';`

## Periodic review (spend visibility)

```sql
SELECT merchant_id, count(*), sum(charged_amount)
FROM public.merchant_shipping_charges
WHERE funding_source = 'platform' AND created_at > now() - interval '30 days'
GROUP BY merchant_id;
SELECT merchant_id, enabled FROM private.platform_funded_gigl_merchants;
```

## GIG cancels a booked platform shipment

The cancellation guard raises `active_merchant_shipping_charge` (55P03) and the
order stays blocked. No wallet was debited, so nothing to refund. Find them:

```sql
SELECT order_id, status FROM public.merchant_shipping_charges
WHERE funding_source = 'platform' AND status IN ('booked','needs_reconciliation');
```

Confirm cancellation with GIG, then set the charge as postgres: `UPDATE public.merchant_shipping_charges SET status = 'refunded', failure_code = 'PROVIDER_CANCELLED_MANUAL', refunded_at = now(), updated_at = now() WHERE id = '<charge id>' AND funding_source = 'platform';`
(no wallet movement; the CHECK forbids wallet transaction ids on platform charges).
