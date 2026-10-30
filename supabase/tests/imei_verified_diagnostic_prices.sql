-- Disposable database only; prove the new public price without expanding
-- unmatched diagnostics, direct grants, ownership or wallet replay authority.
BEGIN;
INSERT INTO private.imei_access_secrets(singleton,secret)
  VALUES(true,'test-imei-access-secret-at-least-32-bytes')
  ON CONFLICT(singleton) DO UPDATE SET secret=excluded.secret;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.imei_price_test_call(operation text,args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload text; issued bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
  payload := jsonb_build_object('version',1,'actor','00000000-0000-4000-8000-000000000001',
    'customer','30000000-0000-4000-8000-000000000001',
    'merchant','10000000-0000-4000-8000-000000000001','operation',operation,
    'issuedAt',issued,'expiresAt',issued+120,'args',args)::text;
  RETURN public.imei_lookup_access(payload,encode(extensions.hmac('baci:imei-access:v1:'||payload,
    'test-imei-access-secret-at-least-32-bytes','sha256'),'hex'));
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE args jsonb; r jsonb; lookup_id uuid; price numeric; balance numeric; after_balance numeric;
BEGIN
  BEGIN
    PERFORM public.imei_lookup_access('{}',repeat('0',64));
    RAISE EXCEPTION 'price extension accepted forged proof';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_table_privilege('authenticated','public.imei_lookups','INSERT')
    OR has_function_privilege('anon','public.imei_lookup_access(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.refund_imei_wallet_payment(uuid,uuid,numeric,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'price extension expanded direct grants';
  END IF;
  args:=jsonb_build_object('customer_id','30000000-0000-4000-8000-000000000001',
    'merchant_id','10000000-0000-4000-8000-000000000001','tier','esimCompatibility',
    'imei_hash',repeat('e',64),'device_category','smartphone',
    'idempotency_key','40000000-0000-4000-8000-000000001941','amount_ngn',700,'status','pending');
  FOREACH price IN ARRAY ARRAY[0,1,699,701] LOOP
    BEGIN
      PERFORM pg_temp.imei_price_test_call('insert_pending',args||jsonb_build_object('amount_ngn',price));
      RAISE EXCEPTION 'eSIM accepted price other than existing NGN700';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM pg_temp.imei_price_test_call('insert_pending',args||'{"tier":"knoxEnrollment","amount_ngn":1000}'::jsonb);
    RAISE EXCEPTION 'unmatched diagnostic became purchasable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_price_test_call('insert_pending',args||'{"tier":"replacementStatus"}'::jsonb);
    RAISE EXCEPTION 'unverified diagnostic became purchasable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r:=pg_temp.imei_price_test_call('insert_pending',args); lookup_id:=(r->>'id')::uuid;
  SELECT available_balance INTO balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.imei_price_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  PERFORM pg_temp.imei_price_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance-700 THEN RAISE EXCEPTION 'eSIM replay charged twice'; END IF;
  PERFORM pg_temp.imei_price_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  PERFORM pg_temp.imei_price_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance THEN RAISE EXCEPTION 'eSIM refund replay minted money'; END IF;
  args:=args||'{"tier":"applePartNumber","idempotency_key":"40000000-0000-4000-8000-000000001963"}'::jsonb;
  FOREACH price IN ARRAY ARRAY[0,1,699,701] LOOP
    BEGIN
      PERFORM pg_temp.imei_price_test_call('insert_pending',args||jsonb_build_object('amount_ngn',price));
      RAISE EXCEPTION 'part-number check accepted price other than existing NGN700';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  r:=pg_temp.imei_price_test_call('insert_pending',args); lookup_id:=(r->>'id')::uuid;
  PERFORM pg_temp.imei_price_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  PERFORM pg_temp.imei_price_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance-700 THEN RAISE EXCEPTION 'part-number replay charged twice'; END IF;
  PERFORM pg_temp.imei_price_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',700));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance THEN RAISE EXCEPTION 'part-number refund lost money'; END IF;
END $$;
ROLLBACK;
