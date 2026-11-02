-- Business invariant: disabled/missing POD settings cannot create an order
-- or switch an existing order to POD, regardless of the calling wrapper.
BEGIN;
-- Fixture writes use the existing service audit identity, as real setup does.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE
  enabled uuid := '36700000-0000-4000-8000-000000000001';
  disabled uuid := '36700000-0000-4000-8000-000000000002';
  missing uuid := '36700000-0000-4000-8000-000000000003';
  target uuid;
  method text;
  accepted uuid;
  card_order uuid;
  rejected boolean;
  codepoint integer;
BEGIN
  IF has_function_privilege('anon','public.is_storefront_pod_order_idempotency_hash(uuid,text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.is_storefront_pod_order_idempotency_hash(uuid,text,text)','EXECUTE')
    OR has_function_privilege('anon','private.is_pay_on_delivery_method(text)','EXECUTE') THEN
    RAISE EXCEPTION 'POD replay probe privileges are incorrect';
  END IF;
  FOREACH codepoint IN ARRAY ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] LOOP
    IF NOT private.is_pay_on_delivery_method(chr(codepoint) || 'POD' || chr(codepoint)) THEN
      RAISE EXCEPTION 'POD classifier rejected whitespace codepoint %',codepoint;
    END IF;
  END LOOP;
  IF private.is_pay_on_delivery_method('p od') OR private.is_pay_on_delivery_method(NULL) THEN
    RAISE EXCEPTION 'POD classifier admitted a non-POD method';
  END IF;
  INSERT INTO public.merchants(id,email,business_name,slug,is_published) VALUES
    (enabled,'pod-enabled@example.com','POD enabled','pod-policy-enabled',true),
    (disabled,'pod-disabled@example.com','POD disabled','pod-policy-disabled',true),
    (missing,'pod-missing@example.com','POD missing','pod-policy-missing',true);
  INSERT INTO public.merchant_feature_settings(merchant_id,pay_on_delivery_enabled)
  VALUES(enabled,true),(disabled,false)
  ON CONFLICT (merchant_id) DO UPDATE SET pay_on_delivery_enabled=EXCLUDED.pay_on_delivery_enabled;
  -- Real merchant insertion creates default feature rows automatically.
  DELETE FROM public.merchant_feature_settings WHERE merchant_id=missing;
  FOREACH target IN ARRAY ARRAY[disabled,missing] LOOP
    FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery','POD',' Pay_On_Delivery ',E'\tPOD\n',U&'\00A0Pay_On_Delivery\00A0'] LOOP
      rejected := false;
      BEGIN
        INSERT INTO public.orders(merchant_id,order_number,total,payment_method,customer_email)
        VALUES(target,'pod-disabled-'||target::text||method,1,method,'fixture@example.com');
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'pay_on_delivery_disabled' THEN RAISE; END IF;
        rejected := true;
      END;
      IF NOT rejected THEN RAISE EXCEPTION 'disabled or missing merchant accepted %',method; END IF;
    END LOOP;
  END LOOP;
  FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery','POD',' Pay_On_Delivery ',E'\tPOD\n',U&'\00A0Pay_On_Delivery\00A0'] LOOP
    INSERT INTO public.orders(merchant_id,order_number,total,payment_method,customer_email)
    VALUES(enabled,'pod-enabled-'||method,1,method,'fixture@example.com') RETURNING id INTO accepted;
  END LOOP;
  INSERT INTO public.orders(merchant_id,order_number,total,payment_method,customer_email)
  VALUES(disabled,'pod-card-control',1,'card','fixture@example.com') RETURNING id INTO card_order;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','storefront_order_context','route','storefront_order_merchant_id',disabled)::text,true);
  UPDATE public.orders SET checkout_idempotency_key='card-key-1234567',checkout_request_hash=repeat('a',64)
    WHERE id=card_order;
  IF public.is_storefront_pod_order_idempotency_hash(disabled,'card-key-1234567',repeat('a',64)) THEN
    RAISE EXCEPTION 'a card order authorized a POD replay';
  END IF;
  UPDATE public.orders SET checkout_idempotency_key='pod-key',checkout_request_hash=repeat('b',64)
    WHERE id=accepted;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','storefront_order_context','route','storefront_order_merchant_id',enabled)::text,true);
  IF public.is_storefront_pod_order_idempotency_hash(enabled,'pod-key',repeat('b',64)) THEN
    RAISE EXCEPTION 'short POD replay key was accepted';
  END IF;
  UPDATE public.orders SET checkout_idempotency_key='pod-key-12345678' WHERE id=accepted;
  IF NOT public.is_storefront_pod_order_idempotency_hash(enabled,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'accepted POD replay was not found';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  IF public.is_storefront_pod_order_idempotency_hash(enabled,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'ordinary authenticated user accessed the replay probe';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','storefront_order_context','route','storefront_order_merchant_id',enabled)::text,true);
  IF public.is_storefront_pod_order_idempotency_hash(disabled,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'another merchant authorized a POD replay';
  END IF;
  IF public.is_storefront_pod_order_idempotency_hash(enabled,'pod-key-12345678',repeat('c',64)) THEN
    RAISE EXCEPTION 'a different hash authorized a POD replay';
  END IF;
  FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery','POD',' Pay_On_Delivery ',E'\tPOD\n',U&'\00A0Pay_On_Delivery\00A0'] LOOP
    rejected := false;
    BEGIN
      UPDATE public.orders SET payment_method=method WHERE id=card_order;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'pay_on_delivery_disabled' THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'existing order switched to disabled %',method; END IF;
  END LOOP;
  UPDATE public.merchant_feature_settings SET pay_on_delivery_enabled=false WHERE merchant_id=enabled;
  -- The exact persisted identity remains accepted after disabling POD.
  UPDATE public.orders SET payment_method=payment_method WHERE id=accepted;
  UPDATE public.orders SET payment_method='pod' WHERE id=accepted;
  UPDATE public.orders SET payment_method='pay_on_delivery' WHERE id=accepted;
  UPDATE public.orders SET payment_method='POD' WHERE id=accepted;
  rejected := false;
  BEGIN
    UPDATE public.orders SET merchant_id=disabled WHERE id=accepted;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'pay_on_delivery_disabled' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'another merchant inherited POD permission'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE merchant_id IN (disabled,missing)
      AND lower(btrim(payment_method)) IN ('pod','pay_on_delivery')) THEN
    RAISE EXCEPTION 'rejected POD attempt left an order behind';
  END IF;
END $$;
-- Exercise the SECURITY DEFINER boundary as real PostgREST roles. Guest route
-- claims intentionally have no sub; ordinary users cannot mint route claims.
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid := '36700000-0000-4000-8000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','storefront_order_context','route','storefront_order_merchant_id',target)::text,true);
  IF NOT public.is_storefront_pod_order_idempotency_hash(target,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'scoped guest route could not verify POD replay';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-2222-3333-4444-555555555555"}',true);
  IF public.is_storefront_pod_order_idempotency_hash(target,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'ordinary authenticated caller accessed POD replay';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"36700000-0000-4000-8000-000000000002"}',true);
  IF public.is_storefront_pod_order_idempotency_hash(target,'pod-key-12345678',repeat('b',64)) THEN
    RAISE EXCEPTION 'wrong-merchant route claim accessed POD replay';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
-- Separate preconditions make a replay failure distinguishable from a
-- failed invocation inside the following anonymous block.
SELECT 1 / CASE WHEN current_user = 'anon' THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_language_privilege(current_user, 'plpgsql', 'USAGE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_function_privilege(current_user, 'public.is_storefront_pod_order_idempotency_hash(uuid,text,text)', 'EXECUTE') THEN 1 ELSE 0 END;
DO $$
BEGIN
  BEGIN
    PERFORM public.is_storefront_pod_order_idempotency_hash('36700000-0000-4000-8000-000000000001'::uuid,'pod-key-12345678',repeat('b',64));
    RAISE EXCEPTION 'anonymous caller executed POD replay probe';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
