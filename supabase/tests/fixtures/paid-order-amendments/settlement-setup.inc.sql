CREATE FUNCTION pg_temp.amendment_settlement_seed(p_delta bigint,p_merchant uuid DEFAULT NULL,p_confirm boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m uuid := COALESCE(p_merchant,gen_random_uuid());
  actor uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  replacement uuid := gen_random_uuid();
  line uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  wallet uuid;
  bank uuid := gen_random_uuid();
  payment_reference text := 'FIX-SETTLE-' || o::text;
  preview jsonb;
  confirmed jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF p_merchant IS NULL THEN
    INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES (actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',actor || '@example.invalid',now(),now());
    INSERT INTO public.merchants(id,user_id,email,business_name,slug)
    VALUES (m,actor,actor || '@example.invalid','Synthetic settlement','fixture-' || m);
    INSERT INTO private.paid_order_amendment_config(merchant_id,version,enabled,scenarios,paystack_integration_id,
      bank_account_id,bank_evidence_cutover,automated_paystack_refunds)
    VALUES (m,1,true,ARRAY['paystack_integration_wallet:product_scalar:upgrade','paystack_integration_wallet:product_scalar:downgrade','paystack_integration_wallet:product_scalar:equal'],
      987,bank,now() - interval '1 day',true);
  ELSE
    SELECT user_id INTO STRICT actor FROM public.merchants WHERE id = m;
    SELECT bank_account_id INTO STRICT bank FROM private.paid_order_amendment_config WHERE merchant_id = m;
  END IF;
  wallet := public.get_or_create_merchant_wallet(m);
  UPDATE public.merchant_wallets SET upcoming_balance = upcoming_balance + 299000, upcoming_count = upcoming_count + 1
  WHERE id = wallet;
  INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_method,payment_status,shipping_status,total,subtotal,amount_paid)
  VALUES (o,m,o::text,'online_store','NGN','card','paid','pending',300000,300000,300000);
  INSERT INTO public.products(id,merchant_id,name,price,status,taxable,vat_rate,stock_quantity,manage_stock,inventory_tracking_policy,images)
  VALUES (source,m,'Original',300000,'active',false,0,0,true,'off','["https://example.invalid/original.png"]'),
    (replacement,m,'Replacement',300000+p_delta::numeric/100,'active',false,0,1,true,'off','["https://example.invalid/replacement.png"]');
  INSERT INTO public.order_items(id,order_id,product_id,name,price,quantity,vat_rate,vat_amount,image_url)
    VALUES (line,o,source,'Original',300000,1,0,0,'https://example.invalid/original-snapshot.png');
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,gateway_response)
  VALUES (capture,m,o,'payment',300000,'NGN','completed','paystack',payment_reference,
    '{"id":"531","channel":"card","domain":"test","integration":"987"}');
  INSERT INTO public.merchant_settlements(merchant_id,wallet_id,source_type,source_id,gateway,gateway_reference,gross_amount,net_amount,
    expected_settlement_date,metadata)
  VALUES (m,wallet,'order',o,'paystack',payment_reference,300000,299000,current_date,'{"paystack_collection":"integration"}');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  preview := public.preview_paid_order_amendment(o,jsonb_build_object('lineId',line,
    'replacement',jsonb_build_object('kind','product','id',replacement)));
  IF p_confirm THEN
    confirmed := public.confirm_paid_order_amendment(o,jsonb_build_object(
      'previewId',preview->>'previewId','customerAgreed',true,'reason','Synthetic swap','idempotencyKey','fixture-confirm'));
  END IF;
  RETURN jsonb_build_object('merchant',m,'actor',actor,'order',o,'amendment',confirmed->>'amendmentId',
    'preview',preview->>'previewId','line',line,'bank',bank,'source',source,'replacement',replacement,'wallet',wallet,'capture',capture,'captureReference',payment_reference);
END;
$$;

CREATE FUNCTION pg_temp.amendment_action(f jsonb,payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.run_paid_order_amendment_action((f->>'order')::uuid,(f->>'amendment')::uuid,payload);
$$;

CREATE FUNCTION pg_temp.amendment_bank(f jsonb,p_minor bigint,p_related uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  prior text := current_setting('request.jwt.claim.role',true);
  evidence uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  evidence := public.register_paid_order_bank_evidence((f->>'bank')::uuid,gen_random_uuid()::text,
    CASE WHEN p_related IS NULL THEN 'incoming' ELSE 'outgoing' END,p_minor,now()-interval '1 minute','synthetic bank entry',p_related);
  PERFORM set_config('request.jwt.claim.role',COALESCE(prior,''),true);
  RETURN evidence;
END;
$$;
