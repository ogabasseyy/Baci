CREATE OR REPLACE FUNCTION pg_temp.verified_funding_fixture(
  p_method text, p_mixed boolean DEFAULT false, p_adjustment_minor bigint DEFAULT 2000000
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  original uuid := gen_random_uuid();
  replacement uuid := gen_random_uuid();
  old_variant uuid := gen_random_uuid();
  new_variant uuid := gen_random_uuid();
  old_unit uuid := gen_random_uuid();
  new_unit uuid := gen_random_uuid();
  line uuid := gen_random_uuid();
  bank uuid := gen_random_uuid();
  entry uuid;
  captures uuid[] := ARRAY[gen_random_uuid()];
  old_price numeric := 129867.50;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES (actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    actor || '@example.invalid',now(),now());
  INSERT INTO public.merchants(id,user_id,email,business_name,slug)
  VALUES (m,actor,actor || '@example.invalid','Synthetic amendment merchant','verified-funding-' || m);
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,payment_status,shipping_status,total,subtotal,amount_paid)
  VALUES (o,m,'STAGE-SWAP-' || o,CASE WHEN p_mixed THEN 'mobile_app' ELSE 'online_store' END,
    'NGN',p_method,'paid','pending',old_price,old_price,old_price);
  INSERT INTO public.products(id,merchant_id,name,price,status,taxable,vat_rate,has_variants,inventory_tracking_policy)
  VALUES (original,m,'Tecno Pop 10',old_price,'active',false,0,true,'serialized_strict'),
    (replacement,m,'Tecno Pop 20',old_price + p_adjustment_minor::numeric/100,'active',false,0,true,'serialized_strict');
  INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,attributes)
  VALUES (old_variant,original,m,'serialized_strict','{"ram":"2 GB","storage":"32 GB"}'),
    (new_variant,replacement,m,'serialized_strict','{"ram":"3 GB","storage":"64 GB"}');
  INSERT INTO public.order_items(id,order_id,product_id,variant_id,name,variant_name,price,quantity,vat_rate,vat_amount)
  VALUES (line,o,original,old_variant,'Tecno Pop 10','2 GB / 32 GB',old_price,1,0,0);
  INSERT INTO public.variant_inventory(id,variant_id,merchant_id,identifier_type,identifier_value,status,order_id,order_item_id)
  VALUES (old_unit,old_variant,m,'serial','OLD-' || o,'reserved',o,line),
    (new_unit,new_variant,m,'serial','NEW-' || o,'available',NULL,NULL);
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
  VALUES (captures[1],m,o,'payment',CASE WHEN p_mixed THEN old_price - 10000 ELSE old_price END,'NGN','completed',
    CASE WHEN p_method IN ('bank_transfer','cash') THEN 'manual' ELSE p_method END,'SYNTHETIC-CAPTURE-' || o,
    jsonb_build_object('payment_method',p_method));
  IF p_mixed THEN
    captures := array_append(captures,gen_random_uuid());
    INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
    VALUES (captures[2],m,o,'payment',10000,'NGN','completed','manual','SYNTHETIC-CASH-' || o,'{"payment_method":"cash"}');
  END IF;
  INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,scenarios,bank_account_id,bank_evidence_cutover)
  VALUES (m,1,true,ARRAY['verified_funds:serialized_variant:upgrade','verified_funds:serialized_variant:equal'],
    bank,now()-interval '1 day');
  INSERT INTO private.paid_order_verified_funding(order_id,capture_ids,capture_digest,approval_reference)
  VALUES (o,captures,private.paid_order_verified_capture_digest(o,m,captures,old_price),'SYNTHETIC-FUNDING-APPROVAL');
  IF p_adjustment_minor > 0 THEN
    entry := public.register_paid_order_bank_evidence(bank,'SYNTHETIC-BANK-' || o,'incoming',p_adjustment_minor,
      now()-interval '1 minute','synthetic statement credit',NULL,o);
  END IF;
  RETURN jsonb_build_object('order',o,'actor',actor,'merchant',m,'line',line,'variant',new_variant,
    'oldUnit',old_unit,'newUnit',new_unit,'bankEvidenceId',entry,'captureIds',captures);
END;
$$;
