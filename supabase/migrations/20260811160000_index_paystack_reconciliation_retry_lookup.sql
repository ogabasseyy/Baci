-- Keep idempotent manual Paystack retries indexed by their order, provider
-- reference, and reconciliation review metadata instead of scanning captures.
CREATE INDEX IF NOT EXISTS transactions_paystack_reconciliation_retry_idx
  ON public.transactions (
    order_id,
    gateway_reference,
    (metadata ->> 'reconciliation_review_id')
  )
  WHERE lower(trim(COALESCE(gateway, ''))) = 'paystack'
    AND status = 'completed'
    AND metadata ->> 'merchant_invoice_partial_applied' = 'true';
