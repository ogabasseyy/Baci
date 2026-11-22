\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.preview_paid_order_amendment(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.confirm_paid_order_amendment(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.read_paid_order_amendment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'paid order amendment commands are missing';
  END IF;
  IF has_table_privilege('authenticated', 'private.paid_order_amendments', 'INSERT')
    OR has_table_privilege('authenticated', 'private.paid_order_amendment_config', 'UPDATE')
    OR has_function_privilege('anon', 'public.confirm_paid_order_amendment(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'amendment admission can be bypassed';
  END IF;
END
$$;

ROLLBACK;

-- Run with -v fixture_json="$(cat supabase/tests/fixtures/paid-order-amendments/scenarios.json)"
\if :{?fixture_json}
\else
\set fixture_json `tr -d '\n' < supabase/tests/fixtures/paid-order-amendments/scenarios.json`
\endif
BEGIN;
SELECT set_config('baci.amendment_fixture', :'fixture_json', true) IS NOT NULL AS fixture_loaded;

DO $$
DECLARE
  v_case jsonb;
  v_expected jsonb;
  v_merchant uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_original uuid := gen_random_uuid();
  v_replacement uuid := gen_random_uuid();
  v_old_variant uuid := gen_random_uuid();
  v_new_variant uuid := gen_random_uuid();
  v_old_unit uuid := gen_random_uuid();
  v_new_unit uuid := gen_random_uuid();
  v_preview jsonb;
  v_request jsonb;
  v_amendment jsonb;
BEGIN
  SELECT value INTO STRICT v_case FROM jsonb_array_elements(
    current_setting('baci.amendment_fixture')::jsonb->'cases'
  ) WHERE value->>'id' = 'upgrade-paystack-plus-offline';
  v_expected := v_case->'expected';

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (v_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'fixture@example.invalid',now(),now());
  INSERT INTO public.merchants(id,user_id,email,business_name,slug)
    VALUES (v_merchant,v_actor,'fixture@example.invalid','Amendment Fixture','fixture-amendment');
  INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,scenarios)
    VALUES (v_merchant,1,true,ARRAY['paystack_integration_wallet:serialized_variant:upgrade']);
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
    payment_status,shipping_status,total,subtotal,amount_paid)
  VALUES (v_order,v_merchant,'FIXTURE-AMENDMENT','online_store','NGN','card','paid','pending',
    (v_case#>>'{order,totalMinor}')::numeric / 100,(v_case#>>'{order,totalMinor}')::numeric / 100,
    (v_case#>>'{order,totalMinor}')::numeric / 100);
  INSERT INTO public.products(id,merchant_id,name,price,status,taxable,vat_rate,has_variants,inventory_tracking_policy)
  VALUES (v_original,v_merchant,'Fixture original',300000,'active',false,0,true,'serialized_strict'),
    (v_replacement,v_merchant,'Fixture replacement',350000,'active',false,0,true,'serialized_strict');
  INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,attributes)
  VALUES (v_old_variant,v_original,v_merchant,'serialized_strict','{"color":"Black","storage":"128 GB"}'),
    (v_new_variant,v_replacement,v_merchant,'serialized_strict','{"color":"Black","storage":"256 GB"}');
  INSERT INTO public.order_items(id,order_id,product_id,variant_id,name,price,quantity,vat_rate,vat_amount)
  VALUES (v_line,v_order,v_original,v_old_variant,'Fixture original',300000,1,0,0);
  INSERT INTO public.variant_inventory(
    id,variant_id,merchant_id,identifier_type,identifier_value,status,order_id,order_item_id
  ) VALUES (v_old_unit,v_old_variant,v_merchant,'serial','FIXTURE-ORIGINAL','reserved',v_order,v_line),
    (v_new_unit,v_new_variant,v_merchant,'serial','FIXTURE-REPLACEMENT','available',NULL,NULL);
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,gateway_response)
  VALUES (v_merchant,v_order,'payment',300000,'NGN','completed','paystack','fixture-amendment-capture','{"channel":"card"}');
  INSERT INTO public.merchant_settlements(merchant_id,source_type,source_id,gateway,
    gateway_reference,gross_amount,net_amount,expected_settlement_date,metadata)
  VALUES (v_merchant,'order',v_order,'paystack','fixture-amendment-capture',300000,299000,current_date,
    '{"paystack_collection":"integration"}');

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.preview_paid_order_amendment(v_order,jsonb_build_object(
      'lineId',v_line,'replacement',jsonb_build_object('kind','variant','id',v_new_variant)));
    RAISE EXCEPTION 'cross-tenant preview succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  v_preview := public.preview_paid_order_amendment(v_order,jsonb_build_object(
    'lineId',v_line,'replacement',jsonb_build_object('kind','variant','id',v_new_variant)));
  IF (v_preview->>'adjustmentMinor')::bigint <> (v_expected->>'adjustmentMinor')::bigint
     OR (SELECT status FROM public.variant_inventory WHERE id = v_new_unit) <> 'available' THEN
    RAISE EXCEPTION 'preview changed inventory or returned an incorrect price';
  END IF;
  v_request := jsonb_build_object('previewId',v_preview->>'previewId','customerAgreed',true,
    'reason','Fixture replacement','idempotencyKey','fixture-confirm-first');
  UPDATE public.products SET price = price + 1 WHERE id = v_replacement;
  BEGIN
    PERFORM public.confirm_paid_order_amendment(v_order,v_request);
    RAISE EXCEPTION 'stale preview committed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'preview_stale' THEN RAISE; END IF;
  END;
  UPDATE public.products SET price = price - 1 WHERE id = v_replacement;
  UPDATE public.product_variants SET attributes = jsonb_set(attributes,'{storage}','"512 GB"'::jsonb)
    WHERE id = v_new_variant;
  BEGIN
    PERFORM public.confirm_paid_order_amendment(v_order,v_request);
    RAISE EXCEPTION 'confirmation accepted options the customer had not reviewed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'preview_stale' THEN RAISE; END IF;
  END;
  UPDATE public.product_variants SET attributes = jsonb_set(attributes,'{storage}','"256 GB"'::jsonb)
    WHERE id = v_new_variant;

  v_preview := public.preview_paid_order_amendment(v_order,jsonb_build_object(
    'lineId',v_line,'replacement',jsonb_build_object('kind','variant','id',v_new_variant)));
  v_request := jsonb_set(v_request,'{previewId}',v_preview->'previewId');
  PERFORM public.create_payment_transaction(v_merchant,v_order,300000,'NGN','paystack',
    'fixture-pending-winner',0,300000,NULL,'Synthetic shopper',NULL,'{}');
  BEGIN
    PERFORM public.confirm_paid_order_amendment(v_order,v_request);
    RAISE EXCEPTION 'pending payment did not block confirmation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
  DELETE FROM public.transactions WHERE gateway_reference = 'fixture-pending-winner';
  IF (SELECT order_item_id FROM public.variant_inventory WHERE id = v_old_unit) IS DISTINCT FROM v_line
     OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = v_order) THEN
    RAISE EXCEPTION 'blocked command moved inventory or created an amendment';
  END IF;
  v_amendment := public.confirm_paid_order_amendment(v_order,v_request);
  IF v_amendment->>'state' <> v_expected->>'initialState'
    OR (v_amendment->>'holdFulfillment')::boolean IS DISTINCT FROM (v_expected->>'initialHold')::boolean
    OR (v_amendment->>'balanceDueMinor')::bigint <> (v_expected->>'topUpMinor')::bigint
    OR (SELECT status FROM public.variant_inventory WHERE id = v_old_unit) <> 'available'
    OR (SELECT order_item_id FROM public.variant_inventory WHERE id = v_new_unit) IS DISTINCT FROM v_line
    OR (SELECT amount_paid FROM public.orders WHERE id = v_order) <> 300000 THEN
    RAISE EXCEPTION 'confirmation diverged from sanitized fixture';
  END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF public.resolve_paid_order_checkout_capture('fixture-amendment-capture',
    '{"reference":"fixture-amendment-capture","status":"success","currency":"NGN","amount":30000000,"id":345}'::jsonb,
    100000)->>'outcome' IS DISTINCT FROM 'original_replay' THEN
    RAISE EXCEPTION 'original capture replay would reach ordinary completion';
  END IF;
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference)
  VALUES (v_merchant,v_order,'payment',300000,'NGN','failed','paystack','fixture-amendment-old-link');
  FOR replay IN 1..2 LOOP
    IF public.resolve_paid_order_checkout_capture('fixture-amendment-old-link',
      '{"reference":"fixture-amendment-old-link","status":"success","currency":"NGN","amount":30000000,"id":346}'::jsonb,
      100000)->>'outcome' IS DISTINCT FROM 'unapplied' THEN
      RAISE EXCEPTION 'stale legacy payment was allocated to the amended order';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM private.paid_order_checkout_capture_exceptions
      WHERE reference = 'fixture-amendment-old-link') <> 1
    OR (SELECT amount_paid FROM public.orders WHERE id = v_order) IS DISTINCT FROM 300000::numeric
    OR (SELECT payment_status FROM public.orders WHERE id = v_order) IS DISTINCT FROM 'partially_paid'
    OR (SELECT hold_fulfillment FROM private.paid_order_amendments WHERE order_id = v_order) IS DISTINCT FROM true
    OR (SELECT status FROM public.variant_inventory WHERE id = v_old_unit) IS DISTINCT FROM 'available'
    OR (SELECT order_item_id FROM public.variant_inventory WHERE id = v_new_unit) IS DISTINCT FROM v_line THEN
    RAISE EXCEPTION 'stale legacy payment changed amended order money, stock, or hold';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  UPDATE private.paid_order_amendment_previews SET expires_at = now() - interval '1 second'
    WHERE id = (v_preview->>'previewId')::uuid;
  UPDATE private.paid_order_amendment_config SET enabled = false,version = 2 WHERE merchant_id = v_merchant;
  IF public.confirm_paid_order_amendment(v_order,v_request) IS DISTINCT FROM v_amendment THEN
    RAISE EXCEPTION 'authorized replay failed after expiry and pause';
  END IF;
  IF public.read_paid_order_amendment_document(v_order,'current')#>>'{inputs,items,0,variant_name}'
    IS DISTINCT FROM 'Black / 256 GB' THEN
    RAISE EXCEPTION 'the revised invoice lost the replacement variant attributes';
  END IF;

  IF (SELECT count(*) FROM private.variant_inventory_events WHERE order_id = v_order
      AND order_item_id = v_line AND inventory_unit_id = v_old_unit
      AND event_type = 'reservation_released') <> 1
    OR (SELECT count(*) FROM private.variant_inventory_events WHERE order_id = v_order
      AND order_item_id = v_line AND inventory_unit_id = v_new_unit
      AND event_type = 'hold_confirmed') <> 1 THEN
    RAISE EXCEPTION 'serialized stock audit did not retain exactly one release and one replacement hold';
  END IF;
  BEGIN
    PERFORM public.confirm_paid_order_amendment(v_order,
      v_request || '{"reason":"Changed replay payload"}'::jsonb);
    RAISE EXCEPTION 'changed replay payload succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.confirm_paid_order_amendment(v_order,
      v_request || '{"idempotencyKey":"fixture-confirm-second"}'::jsonb);
    RAISE EXCEPTION 'second amendment succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'already_amended' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.order_items SET price = 1 WHERE id = v_line;
    RAISE EXCEPTION 'ordinary line edit bypassed amendment fence';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_hold' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.orders SET shipping_status = 'shipped' WHERE id = v_order;
    RAISE EXCEPTION 'fulfillment bypassed hold';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_hold' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_payment_transaction(v_merchant,v_order,350000,'NGN','paystack',
      'fixture-late-init',0,350000,NULL,'Synthetic shopper',NULL,'{}');
    RAISE EXCEPTION 'pending payment bypassed amendment fence';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'amendment_payment_open' THEN RAISE; END IF;
  END;
END
$$;

ROLLBACK;

BEGIN;
DO $$
DECLARE
  m uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  old_product uuid := gen_random_uuid();
  new_product uuid := gen_random_uuid();
  old_offer uuid := gen_random_uuid();
  new_offer uuid := gen_random_uuid();
  preview jsonb;
  result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'fixture-offer@example.invalid',now(),now());
  INSERT INTO public.merchants(id,user_id,email,business_name,slug)
    VALUES (m,actor,'fixture-offer@example.invalid','Amendment Offer Fixture','fixture-amendment-offer');
  INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,scenarios)
    VALUES (m,1,true,ARRAY['paystack_integration_wallet:condition_offer:downgrade']);
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
    payment_status,shipping_status,total,subtotal,amount_paid)
  VALUES (o,m,'FIXTURE-OFFER','online_store','NGN','card','paid','pending',300000,300000,300000);
  INSERT INTO public.products(id,merchant_id,name,price,status,taxable,vat_rate,stock_quantity,
    inventory_tracking_policy,manage_stock)
  VALUES (old_product,m,'Fixture original',300000,'active',false,0,8,'off',true),
    (new_product,m,'Fixture replacement',250000,'active',false,0,7,'off',true);
  INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity)
  VALUES (old_offer,old_product,m,'used',300000,0),(new_offer,new_product,m,'used',250000,1);
  INSERT INTO public.order_items(id,order_id,product_id,product_offer_id,condition,name,price,quantity,vat_rate,vat_amount)
    VALUES (item,o,old_product,old_offer,'used','Fixture original',300000,1,0,0);
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,
    gateway_reference,gateway_response)
  VALUES (m,o,'payment',300000,'NGN','completed','paystack','fixture-amendment-offer','{"channel":"card"}');
  INSERT INTO public.merchant_settlements(merchant_id,source_type,source_id,gateway,gateway_reference,
    gross_amount,net_amount,expected_settlement_date,metadata)
  VALUES (m,'order',o,'paystack','fixture-amendment-offer',300000,299000,current_date,
    '{"paystack_collection":"integration"}');

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  preview := public.preview_paid_order_amendment(o,jsonb_build_object(
    'lineId',item,'replacement',jsonb_build_object('kind','condition_offer','id',new_offer)));
  result := public.confirm_paid_order_amendment(o,jsonb_build_object(
    'previewId',preview->>'previewId','customerAgreed',true,'reason','Fixture downgrade',
    'idempotencyKey','fixture-offer-confirmation'));
  IF result->>'state' IS DISTINCT FROM 'awaiting_refund'
    OR (result->>'refundOwedMinor')::bigint IS DISTINCT FROM 5000000::bigint
    OR (SELECT amount_paid FROM public.orders WHERE id = o) IS DISTINCT FROM 300000::numeric
    OR (SELECT product_offer_id FROM public.order_items WHERE id = item) IS DISTINCT FROM new_offer
    OR (SELECT stock_quantity FROM public.product_offers WHERE id = old_offer) IS DISTINCT FROM 1
    OR (SELECT stock_quantity FROM public.product_offers WHERE id = new_offer) IS DISTINCT FROM 0
    OR (SELECT stock_quantity FROM public.products WHERE id = old_product) IS DISTINCT FROM 8
    OR (SELECT stock_quantity FROM public.products WHERE id = new_product) IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'condition-offer downgrade changed unexpected stock or money';
  END IF;
END;
$$;
ROLLBACK;
