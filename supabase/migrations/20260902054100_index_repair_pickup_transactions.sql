-- disable-transaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  repairs_pickup_payment_reference_unique_idx
  ON public.repairs (pickup_payment_reference)
  WHERE pickup_payment_reference IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  transactions_repair_pickup_reference_unique_idx
  ON public.transactions (gateway_reference)
  WHERE gateway_reference IS NOT NULL
    AND gateway = 'paystack'
    AND metadata ->> 'transaction_type' = 'repair_pickup';
