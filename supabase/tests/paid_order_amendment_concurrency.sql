-- Run only against the disposable replay database. The two backends need
-- committed fixtures to see each other's writes.
\set ON_ERROR_STOP on
\ir fixtures/paid-order-amendments/concurrency-lock.inc.sql

CREATE FUNCTION pg_temp.amendment_seed(p_shared jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m uuid := COALESCE((p_shared->>'merchant')::uuid,gen_random_uuid());
  actor uuid := COALESCE((p_shared->>'actor')::uuid,gen_random_uuid());
  o uuid := gen_random_uuid();
  line uuid := gen_random_uuid();
  old_product uuid := COALESCE((p_shared->>'oldProduct')::uuid,gen_random_uuid());
  new_product uuid := COALESCE((p_shared->>'newProduct')::uuid,gen_random_uuid());
  old_variant uuid := COALESCE((p_shared->>'oldVariant')::uuid,gen_random_uuid());
  new_variant uuid := COALESCE((p_shared->>'newVariant')::uuid,gen_random_uuid());
  old_unit uuid := gen_random_uuid();
  new_unit uuid := COALESCE((p_shared->>'newUnit')::uuid,gen_random_uuid());
  capture_reference text := 'fixture-paid-' || o::text;
  preview jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF p_shared IS NULL THEN
    INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
      VALUES (actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        actor::text || '@example.invalid',now(),now());
    INSERT INTO public.merchants(id,user_id,email,business_name,slug)
      VALUES (m,actor,actor::text || '@example.invalid','Synthetic Amendment Race','fixture-' || m::text);
    INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,scenarios,paystack_integration_id)
      VALUES (m,1,true,ARRAY['paystack_integration_wallet:serialized_variant:upgrade'],987);
    INSERT INTO public.products(id,merchant_id,name,price,status,taxable,vat_rate,has_variants,inventory_tracking_policy)
      VALUES (old_product,m,'Fixture original',300000,'active',false,0,true,'serialized_strict'),
        (new_product,m,'Fixture replacement',350000,'active',false,0,true,'serialized_strict');
    INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy)
      VALUES (old_variant,old_product,m,'serialized_strict'),
        (new_variant,new_product,m,'serialized_strict');
    INSERT INTO public.variant_inventory(id,variant_id,merchant_id,identifier_type,identifier_value,status)
      VALUES (new_unit,new_variant,m,'serial',new_unit::text,'available');
  END IF;
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,
    payment_status,shipping_status,total,subtotal,amount_paid,customer_email,tracking_token)
  VALUES (o,m,o::text,'online_store','NGN','card','paid','pending',300000,300000,300000,
    'synthetic-shopper@example.invalid','fixture-proof-' || o::text);
  INSERT INTO public.order_items(id,order_id,product_id,variant_id,name,price,quantity,vat_rate,vat_amount)
    VALUES (line,o,old_product,old_variant,'Fixture original',300000,1,0,0);
  INSERT INTO public.variant_inventory(
    id,variant_id,merchant_id,identifier_type,identifier_value,status,order_id,order_item_id
  ) VALUES (old_unit,old_variant,m,'serial',old_unit::text,'reserved',o,line);
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,
    gateway_reference,gateway_response)
  VALUES (m,o,'payment',300000,'NGN','completed','paystack',capture_reference,'{"channel":"card"}');
  INSERT INTO public.merchant_settlements(merchant_id,source_type,source_id,gateway,gateway_reference,
    gross_amount,net_amount,expected_settlement_date,metadata)
  VALUES (m,'order',o,'paystack',capture_reference,300000,299000,current_date,'{"paystack_collection":"integration"}');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  preview := public.preview_paid_order_amendment(o,jsonb_build_object(
    'lineId',line,'replacement',jsonb_build_object('kind','variant','id',new_variant)));
  RETURN jsonb_build_object(
    'merchant',m,'actor',actor,'order',o,'oldProduct',old_product,'newProduct',new_product,
    'oldVariant',old_variant,'newVariant',new_variant,'oldUnit',old_unit,'newUnit',new_unit,
    'payload',jsonb_build_object('previewId',preview->>'previewId','customerAgreed',true,
      'reason','Fixture swap','idempotencyKey','fixture-race-key')
  );
END;
$$;

CREATE FUNCTION pg_temp.amendment_confirm_sql(p_seed jsonb)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.confirm_paid_order_amendment(%L,%L)::text',
    p_seed->>'order',p_seed->'payload');
$$;

CREATE FUNCTION pg_temp.amendment_payment_sql(p_seed jsonb)
RETURNS text LANGUAGE sql AS $$
  SELECT format(
    'SELECT public.create_payment_transaction(%L,%L,300000,''NGN'',''paystack'',%L,0,300000,''synthetic-shopper@example.invalid'',''Synthetic shopper'')::text',
    p_seed->>'merchant',p_seed->>'order','fixture-race-' || (p_seed->>'order')
  );
$$;

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(:'seed'::jsonb->>'actor',pg_temp.amendment_payment_sql(:'seed'),
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),'amendment_payment_open',
  (:'seed'::jsonb->>'order')::uuid);
SELECT 1 / ((
  (SELECT count(*) FROM public.transactions WHERE order_id = (:'seed'::jsonb->>'order')::uuid
    AND status = 'pending') = 1
  AND NOT EXISTS (SELECT 1 FROM private.paid_order_amendments
    WHERE order_id = (:'seed'::jsonb->>'order')::uuid)
)::integer);

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(:'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'seed'::jsonb->>'actor',pg_temp.amendment_payment_sql(:'seed'),'amendment_payment_open');
SELECT 1 / ((
  (SELECT count(*) FROM private.paid_order_amendments
    WHERE order_id = (:'seed'::jsonb->>'order')::uuid) = 1
  AND NOT EXISTS (SELECT 1 FROM public.transactions
    WHERE order_id = (:'seed'::jsonb->>'order')::uuid AND status = 'pending')
)::integer);

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_seed(:'seed') AS second_seed \gset
SELECT pg_temp.amendment_run_race(:'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'second_seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'second_seed'),'replacement_unavailable');
SELECT 1 / ((SELECT order_id FROM public.variant_inventory
  WHERE id = (:'seed'::jsonb->>'newUnit')::uuid) = (:'seed'::jsonb->>'order')::uuid)::integer;
SELECT 1 / ((SELECT status FROM public.variant_inventory
  WHERE id = (:'second_seed'::jsonb->>'oldUnit')::uuid) = 'reserved')::integer;

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',
  format('UPDATE private.paid_order_amendment_config SET enabled = false, version = 2 WHERE merchant_id = %L',
    :'seed'::jsonb->>'merchant'),
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),'scenario_disabled');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',
  format('SELECT to_jsonb(s)::text FROM public.claim_order_shipment_booking(%L,%L,gen_random_uuid()) s',
    :'seed'::jsonb->>'order',:'seed'::jsonb->>'merchant'),
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),'amendment_fulfillment_open');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'seed'::jsonb->>'actor',
  format('SELECT public.cancel_order_as_merchant(%L,''Synthetic cancellation'',''manual'')::text',
    :'seed'::jsonb->>'order'),
  'amendment_hold');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'seed'::jsonb->>'actor',
  format('SELECT to_jsonb(s)::text FROM public.claim_order_shipment_booking(%L,%L,gen_random_uuid()) s',
    :'seed'::jsonb->>'order',:'seed'::jsonb->>'merchant'),
  'amendment_hold');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',
  format('SELECT public.cancel_order_as_merchant(%L,''Synthetic cancellation'',''manual'')::text',
    :'seed'::jsonb->>'order'),
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),'amendment_fulfillment_open');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'seed'::jsonb->>'actor',
  format('SELECT public.claim_checkout_for_paid_order_amendment(%L,%L,''paystack'',''BAC-STALEINIT001'',''NGN'',30000000)',
    :'seed'::jsonb->>'order', (SELECT tracking_token FROM public.orders WHERE id = (:'seed'::jsonb->>'order')::uuid)),
  'amendment_payment_open');

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'seed'::jsonb->>'actor',
  format('UPDATE private.paid_order_amendment_config SET enabled = false, version = 2 WHERE merchant_id = %L',
    :'seed'::jsonb->>'merchant'),NULL);
SELECT 1 / ((SELECT config_version FROM private.paid_order_amendments
  WHERE order_id = (:'seed'::jsonb->>'order')::uuid) = 1)::integer;
SELECT set_config('request.jwt.claim.sub',:'seed'::jsonb->>'actor',false) IS NOT NULL;
SELECT 1 / (
  (public.confirm_paid_order_amendment((:'seed'::jsonb->>'order')::uuid,:'seed'::jsonb->'payload')->>'amendmentId')::uuid
  = (SELECT id FROM private.paid_order_amendments WHERE order_id = (:'seed'::jsonb->>'order')::uuid)
)::integer;

SELECT pg_temp.amendment_seed() AS seed \gset
SELECT gen_random_uuid() AS shopper, gen_random_uuid() AS customer \gset
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES (:'shopper','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    :'shopper' || '@example.invalid',now(),now());
INSERT INTO public.customers(id,merchant_id,user_id,email)
  VALUES (:'customer',(:'seed'::jsonb->>'merchant')::uuid,:'shopper',:'shopper' || '@example.invalid');
UPDATE public.orders SET customer_id = :'customer' WHERE id = (:'seed'::jsonb->>'order')::uuid;
SELECT set_config('request.jwt.claim.sub',:'seed'::jsonb->>'actor',false) IS NOT NULL;
SELECT jsonb_set(:'seed'::jsonb, '{payload,previewId}', public.preview_paid_order_amendment(
  (:'seed'::jsonb->>'order')::uuid,
  jsonb_build_object(
    'lineId',(SELECT id FROM public.order_items WHERE order_id = (:'seed'::jsonb->>'order')::uuid),
    'replacement',jsonb_build_object('kind','variant','id',:'seed'::jsonb->>'newVariant')
  ))->'previewId') AS seed \gset
SELECT pg_temp.amendment_run_race(
  :'seed'::jsonb->>'actor',pg_temp.amendment_confirm_sql(:'seed'),
  :'shopper',format('SELECT public.cancel_order_as_customer(%L,''Synthetic customer cancellation'')::text',
    :'seed'::jsonb->>'order'),
  'order_not_cancellable');
