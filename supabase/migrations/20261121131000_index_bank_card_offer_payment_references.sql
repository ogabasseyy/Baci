-- disable-transaction
-- Signed webhooks and disputes resolve by reference before merchant identity
-- is known. The order-first index cannot enforce uniqueness across orders.
DO $cleanup$
DECLARE existing record;
BEGIN
  SELECT indrelid, indisvalid, indisready, indisunique, indnatts,
    pg_catalog.pg_get_indexdef(indexrelid, 1, true) AS column_definition,
    pg_catalog.pg_get_expr(indpred, indrelid) AS predicate
    INTO existing
  FROM pg_catalog.pg_index
  WHERE indexrelid = pg_catalog.to_regclass('public.transactions_bank_offer_reference_uidx');

  IF NOT FOUND THEN RETURN; END IF;
  IF existing.indrelid <> 'public.transactions'::regclass
    OR NOT existing.indisunique OR existing.indnatts <> 1
    OR existing.column_definition IS DISTINCT FROM 'gateway_reference'
    OR existing.predicate IS DISTINCT FROM
      $predicate$((gateway = 'paystack'::text) AND (transaction_type = 'payment'::text) AND (gateway_reference ~~ 'BCO-%'::text))$predicate$
  THEN
    RAISE EXCEPTION 'bank_offer_reference_index_definition_mismatch';
  END IF;
  IF NOT existing.indisvalid OR NOT existing.indisready THEN
    PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
    DROP INDEX public.transactions_bank_offer_reference_uidx;
  END IF;
END;
$cleanup$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transactions_bank_offer_reference_uidx
  ON public.transactions (gateway_reference)
  WHERE gateway = 'paystack' AND transaction_type = 'payment'
    AND gateway_reference LIKE 'BCO-%';

-- An interrupted concurrent build can leave an invalid index. Fail the
-- migration if the index cannot guarantee an unambiguous reference.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid = pg_catalog.to_regclass('public.transactions_bank_offer_reference_uidx')
      AND indrelid = 'public.transactions'::regclass
      AND indisvalid AND indisready AND indisunique
  ) THEN RAISE EXCEPTION 'bank_offer_reference_index_invalid'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_card_offer_webhook_transaction(p_reference text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'merchant_id', s.merchant_id, 'order_id', s.order_id,
    'gateway', t.gateway, 'gateway_reference', t.gateway_reference,
    'amount', t.amount, 'platform_fee', t.platform_fee
  )
  FROM public.transactions t
  JOIN private.bank_card_offer_payment_attempts a ON a.transaction_id = t.id
  JOIN private.bank_card_offer_order_snapshots s ON s.order_id = a.order_id
  JOIN public.orders o ON o.id = s.order_id AND o.merchant_id = s.merchant_id
  WHERE t.gateway_reference = p_reference AND t.gateway_reference LIKE 'BCO-%'
    AND t.gateway = 'paystack'
    AND t.transaction_type = 'payment' AND t.currency = 'NGN'
    AND t.merchant_id = s.merchant_id AND t.order_id = s.order_id
    AND t.amount * 100 = s.payable_kobo
    AND o.payment_method = 'bank_card_offer';
$$;
