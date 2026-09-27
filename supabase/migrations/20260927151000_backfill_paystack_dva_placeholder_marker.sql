-- Backfill the DVA marker on placeholders created before the initializer
-- recorded it, so the abandoned-attempt sweep can retire them when
-- Paystack confirms their reference is missing. New rows are marked at
-- creation; this one-shot repair covers only currently unresolved rows
-- on orders with a trusted DVA assignment. The marker is read only by
-- the sweep's missing-reference branch, so a marked row retires solely
-- when its reference does not exist at the provider.
UPDATE public.transactions t
SET metadata = coalesce(t.metadata, '{}'::jsonb) || '{"paystack_payment_type": "dva"}'::jsonb,
    updated_at = now()
WHERE t.transaction_type = 'payment'
  AND t.gateway = 'paystack'
  AND t.status IN ('pending', 'processing')
  AND coalesce(t.metadata->>'paystack_payment_type', '') IS DISTINCT FROM 'dva'
  AND EXISTS (
    SELECT 1 FROM public.order_payment_accounts a
    WHERE a.order_id = t.order_id AND a.provider = 'paystack'
  );
