\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.resolve_paid_order_checkout_capture(text,jsonb,bigint)') IS NULL THEN
    RAISE EXCEPTION 'verified checkout capture resolver missing';
  END IF;
  IF has_function_privilege('authenticated',
    'public.resolve_paid_order_checkout_capture(text,jsonb,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verified checkout capture resolver must be worker-owned';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_merchant uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_stale uuid := gen_random_uuid();
  v_quote uuid := gen_random_uuid();
  v_ref text := 'BAC-EARLYCAP0001';
  v_stale_ref text := 'BAC-STALECAP0001';
  v_capture jsonb;
  v_result jsonb;
  v_txn uuid;
  v_mismatch_order uuid;
  v_mismatch_ref text;
  v_mismatch jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'fixture-capture@example.invalid',now(),now());
  INSERT INTO public.merchants(id,user_id,email,business_name,slug)
    VALUES (v_merchant,v_owner,'fixture-capture@example.invalid','Amendment Capture Fixture','fixture-amendment-capture');
  INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,paystack_integration_id)
    VALUES (v_merchant,1,true,987);
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
    payment_status,shipping_status,total,subtotal,amount_paid,tracking_token,customer_email)
  VALUES (v_order,v_merchant,'FIXTURE-EARLY','online_store','NGN','card','unpaid','pending',
    300000,300000,0,'synthetic-claim-proof','fixture-shopper@example.invalid'),
    (v_stale,v_merchant,'FIXTURE-STALE','online_store','NGN','card','unpaid','pending',
    300000,300000,0,'synthetic-stale-proof','fixture-shopper@example.invalid');
  INSERT INTO public.merchant_feature_settings(merchant_id,shipping_providers)
  VALUES (v_merchant,'["gigl"]') ON CONFLICT (merchant_id) DO UPDATE SET shipping_providers = EXCLUDED.shipping_providers;
  INSERT INTO public.shipping_quotes(id,session_id,provider,price,expires_at,merchant_id,
    provider_cost,platform_margin,pricing_version)
  VALUES (v_quote,'fixture-early-capture','GIGL',250,now() + interval '1 hour',v_merchant,
    200,50,'gigl_platform_margin_v1');
  UPDATE public.orders SET shipping_fee = 250, subtotal = 299750, shipping_provider = 'GIGL',
    shipping_funding_source = 'customer_checkout', selected_quote_id = v_quote
  WHERE id = v_order;

  IF public.claim_checkout_for_paid_order_amendment(
    v_order,'synthetic-claim-proof','paystack',v_ref,'NGN',30000000
  ) <> 'claimed' OR EXISTS (SELECT 1 FROM public.transactions WHERE gateway_reference = v_ref) THEN
    RAISE EXCEPTION 'checkout claim did not precede transaction insertion';
  END IF;
  v_capture := jsonb_build_object('reference',v_ref,'id',345,'integration',987,
    'status','success','currency','NGN','channel','card','amount',30000000);
  v_result := public.resolve_paid_order_checkout_capture(v_ref,v_capture - 'integration',100000);
  IF v_result->>'outcome' IS DISTINCT FROM 'awaiting_evidence' THEN
    RAISE EXCEPTION 'missing integration did not defer checkout capture';
  END IF;
  v_result := public.resolve_paid_order_checkout_capture(v_ref,v_capture,100000);
  IF v_result->>'outcome' IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'verified early capture could not resume normal settlement';
  END IF;
  SELECT id INTO STRICT v_txn FROM public.transactions WHERE gateway_reference = v_ref;
  IF (SELECT merchant_amount FROM public.transactions WHERE id = v_txn) IS DISTINCT FROM 298750::numeric THEN
    RAISE EXCEPTION 'early capture lost the retained shipping portion of the Paystack split';
  END IF;
  IF to_regprocedure('public.complete_order_gateway_payment(uuid,uuid,jsonb,text,bigint)') IS NOT NULL THEN
    v_result := public.complete_order_gateway_payment(v_txn,v_order,v_capture,'fixture-webhook',NULL);
    IF v_result->>'payment_status' IS DISTINCT FROM 'paid'
      OR (SELECT count(*) FROM public.payment_side_effects WHERE order_id = v_order
        AND step = 'merchant_settlement') <> 1 THEN
      RAISE EXCEPTION 'early capture did not seed exactly one settlement step';
    END IF;
  END IF;
  IF public.create_payment_transaction(v_merchant,v_order,300000,'NGN','paystack',
    v_ref,1000,298750,'fixture-shopper@example.invalid','Synthetic shopper') IS DISTINCT FROM v_txn THEN
    RAISE EXCEPTION 'initializer resume did not reuse the materialized payment';
  END IF;
  IF to_regprocedure('public.complete_order_gateway_payment(uuid,uuid,jsonb,text,bigint)') IS NOT NULL
    AND (SELECT payment_status FROM public.orders WHERE id = v_order) IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'initializer replay regressed a completed payment';
  END IF;
  IF public.resolve_paid_order_checkout_capture(v_ref,v_capture,100000)->>'outcome' IS DISTINCT FROM 'ready'
    OR (SELECT count(*) FROM public.transactions WHERE gateway_reference = v_ref) <> 1 THEN
    RAISE EXCEPTION 'capture replay created another payment';
  END IF;

  PERFORM public.claim_checkout_for_paid_order_amendment(
    v_stale,'synthetic-stale-proof','paystack',v_stale_ref,'NGN',30000000);
  UPDATE public.orders SET payment_status = 'paid', amount_paid = 300000 WHERE id = v_stale;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  BEGIN
    PERFORM public.preview_paid_order_amendment(v_stale,jsonb_build_object(
      'lineId',gen_random_uuid(),'replacement',jsonb_build_object('kind','variant','id',gen_random_uuid())));
    RAISE EXCEPTION 'amendment bypassed a pre-provider claim without a transaction';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  v_capture := v_capture || jsonb_build_object('reference',v_stale_ref,'id',346);
  FOR i IN 1..2 LOOP
    IF public.resolve_paid_order_checkout_capture(v_stale_ref,v_capture,100000)->>'outcome'
       IS DISTINCT FROM 'unapplied' THEN
      RAISE EXCEPTION 'stale capture was treated as funding';
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.create_payment_transaction(v_merchant,v_stale,300000,'NGN','paystack',
      v_stale_ref,1000,299000,'fixture-shopper@example.invalid','Synthetic shopper');
    RAISE EXCEPTION 'initializer reopened an unapplied charge';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'paid_order_capture_requires_reconciliation' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM private.paid_order_checkout_capture_exceptions
      WHERE reference = v_stale_ref AND outcome = 'unapplied') <> 1
    OR (SELECT count(*) FROM public.transactions WHERE gateway_reference = v_stale_ref) <> 0
    OR (SELECT amount_paid FROM public.orders WHERE id = v_stale) <> 300000 THEN
    RAISE EXCEPTION 'stale capture changed original order funding';
  END IF;
  FOR mismatch IN 1..3 LOOP
    v_mismatch_order := gen_random_uuid();
    v_mismatch_ref := 'BAC-MISMATCH' || lpad(mismatch::text,4,'0');
    INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
      payment_status,shipping_status,total,subtotal,amount_paid,tracking_token)
    VALUES (v_mismatch_order,v_merchant,v_mismatch_order::text,'online_store','NGN','card',
      'unpaid','pending',300000,300000,0,'synthetic-proof-' || v_mismatch_order::text);
    PERFORM public.claim_checkout_for_paid_order_amendment(
      v_mismatch_order,'synthetic-proof-' || v_mismatch_order::text,'paystack',v_mismatch_ref,'NGN',30000000);
    v_mismatch := v_capture || jsonb_build_object('reference',v_mismatch_ref,'id',400+mismatch)
      || CASE mismatch WHEN 1 THEN '{"amount":29999999}'::jsonb
        WHEN 2 THEN '{"currency":"USD"}'::jsonb ELSE '{"integration":999}'::jsonb END;
    IF public.resolve_paid_order_checkout_capture(v_mismatch_ref,v_mismatch,100000)->>'outcome'
       IS DISTINCT FROM 'review'
      OR NOT EXISTS (SELECT 1 FROM private.paid_order_checkout_claims WHERE order_id = v_mismatch_order)
      OR EXISTS (SELECT 1 FROM public.transactions WHERE gateway_reference = v_mismatch_ref) THEN
      RAISE EXCEPTION 'mismatched capture escaped review: %',mismatch;
    END IF;
  END LOOP;
END;
$$;
ROLLBACK;
