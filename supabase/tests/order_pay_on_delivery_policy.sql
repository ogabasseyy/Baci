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
BEGIN
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
    FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery'] LOOP
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
  FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery'] LOOP
    INSERT INTO public.orders(merchant_id,order_number,total,payment_method,customer_email)
    VALUES(enabled,'pod-enabled-'||method,1,method,'fixture@example.com') RETURNING id INTO accepted;
  END LOOP;
  INSERT INTO public.orders(merchant_id,order_number,total,payment_method,customer_email)
  VALUES(disabled,'pod-card-control',1,'card','fixture@example.com') RETURNING id INTO card_order;
  FOREACH method IN ARRAY ARRAY['pod','pay_on_delivery'] LOOP
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
  rejected := false;
  BEGIN
    UPDATE public.orders SET merchant_id=disabled WHERE id=accepted;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'pay_on_delivery_disabled' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'another merchant inherited POD permission'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE merchant_id IN (disabled,missing)
      AND payment_method IN ('pod','pay_on_delivery')) THEN
    RAISE EXCEPTION 'rejected POD attempt left an order behind';
  END IF;
END $$;
ROLLBACK;
