-- Backfill the DVA marker on placeholders created before the initializer
-- recorded it, so the abandoned-attempt sweep can retire them when
-- Paystack confirms their reference is missing. New rows are marked at
-- creation; this one-shot repair covers only currently unresolved rows
-- whose insert correlates with a DVA reservation for the same order.
--
-- Correlation, not bare account existence: every DVA initialize refreshes
-- order_payment_accounts.assigned_at (app clock) and inserts this
-- transaction seconds later in the same request, so a placeholder's
-- created_at falls just after the assignment it belongs to. A pending
-- hosted-card retry on the same order is a separate request at a
-- different time and stays unmarked, keeping Paystack 404s inconclusive
-- for it. The two-minute lower allowance covers app/DB clock skew; the
-- five-minute upper bound covers a slow request tail. Rows whose
-- account predates assigned_at tracking (NULL) fail closed to unmarked.
-- The marker is read only by the sweep's missing-reference branch, so a
-- marked row retires solely when its reference does not exist at the
-- provider.
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
      AND a.assigned_at IS NOT NULL
      AND t.created_at >= a.assigned_at - make_interval(mins => 2)
      AND t.created_at <= a.assigned_at + make_interval(mins => 5)
  );
