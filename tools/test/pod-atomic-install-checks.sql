DO $$
DECLARE
  merchant constant uuid := '36700000-0000-4000-8000-000000000001';
  accepted uuid;
  denied boolean := false;
BEGIN
  IF has_function_privilege('anon', 'public.is_storefront_pod_order_idempotency_hash(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_storefront_pod_order_idempotency_hash(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'incorrect replay-probe privileges';
  END IF;
  INSERT INTO public.merchant_feature_settings VALUES (merchant, false);
  BEGIN
    INSERT INTO public.orders(merchant_id,payment_method) VALUES (merchant,U&'\00A0POD\00A0');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'pay_on_delivery_disabled' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'disabled Unicode POD accepted'; END IF;
  UPDATE public.merchant_feature_settings SET pay_on_delivery_enabled=true WHERE merchant_id=merchant;
  INSERT INTO public.orders(merchant_id,payment_method,checkout_idempotency_key,checkout_request_hash)
    VALUES (merchant,'pod','1234567890123456',repeat('a',64)) RETURNING id INTO accepted;
  UPDATE public.merchant_feature_settings SET pay_on_delivery_enabled=false WHERE merchant_id=merchant;
  UPDATE public.orders SET payment_method='Pay_On_Delivery' WHERE id=accepted;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',merchant)::text, true);
  IF NOT public.is_storefront_pod_order_idempotency_hash(merchant,'1234567890123456',repeat('a',64)) THEN
    RAISE EXCEPTION 'scoped accepted POD replay missing';
  END IF;
  IF public.is_storefront_pod_order_idempotency_hash(merchant,'short',repeat('a',64)) THEN
    RAISE EXCEPTION 'short replay key accepted';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  IF public.is_storefront_pod_order_idempotency_hash(merchant,'1234567890123456',repeat('a',64)) THEN
    RAISE EXCEPTION 'unscoped replay accepted';
  END IF;
END $$;
