BEGIN;
INSERT INTO public.merchants(id, email, business_name, slug, is_published)
VALUES ('14bf2192-16de-442b-bf75-700f4ff2aaca', 'lease-test@example.com', 'Lease Test', 'lease-test-3448', true);
SELECT set_config('request.jwt.claims', '{"repair_pickup_receiver_context":"server-payment-start","repair_pickup_receiver_merchant_id":"14bf2192-16de-442b-bf75-700f4ff2aaca"}', true);
DO $$
DECLARE
  m uuid := '14bf2192-16de-442b-bf75-700f4ff2aaca';
  r uuid := '14bf2192-16de-442b-bf75-700f4ff2aacb';
  old_owner uuid := '14bf2192-16de-442b-bf75-700f4ff2aacc';
  new_owner uuid := '14bf2192-16de-442b-bf75-700f4ff2aacd';
  h text := repeat('a',64);
BEGIN
  PERFORM public.mobile_repair_pickup_payment_receipt_v2(m,r,h,old_owner);
  UPDATE public.mobile_repair_pickup_payment_receipts SET claim_expires_at = now() - interval '1 minute'
    WHERE merchant_id=m AND request_id=r;
  IF public.begin_mobile_repair_pickup_payment(m,r,h,old_owner) THEN RAISE EXCEPTION 'expired worker started'; END IF;
  IF public.mobile_repair_pickup_payment_receipt_v2(m,r,h,new_owner)->>'state' <> 'claimed' THEN RAISE EXCEPTION 'abandoned claim not recovered'; END IF;
  IF public.begin_mobile_repair_pickup_payment(m,r,h,old_owner) THEN RAISE EXCEPTION 'stale worker started'; END IF;
  IF NOT public.begin_mobile_repair_pickup_payment(m,r,h,new_owner) THEN RAISE EXCEPTION 'recovery owner could not start'; END IF;
  IF public.begin_mobile_repair_pickup_payment(m,r,h,new_owner) THEN RAISE EXCEPTION 'owner started twice'; END IF;
  UPDATE public.mobile_repair_pickup_payment_receipts SET claim_expires_at = now() - interval '1 day'
    WHERE merchant_id=m AND request_id=r;
  IF public.mobile_repair_pickup_payment_receipt_v2(m,r,h,old_owner)->>'state' <> 'pending' THEN RAISE EXCEPTION 'unknown execution reclaimed'; END IF;
  IF public.mobile_repair_pickup_payment_receipt_v2(m,r,h,new_owner,
    '{"success":false,"code":"payment_initialization_unknown"}'::jsonb)->>'state' <> 'unknown'
  THEN RAISE EXCEPTION 'checkpoint not retained as unknown'; END IF;
  BEGIN
    PERFORM public.mobile_repair_pickup_payment_receipt_v2(m,r,h,old_owner,'{"success":true}'::jsonb);
    RAISE EXCEPTION 'nonowner replaced checkpoint';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.mobile_repair_pickup_payment_receipt_v2(m,r,h,new_owner,'{"success":true}'::jsonb)->>'state' <> 'complete'
  THEN RAISE EXCEPTION 'owner could not finish checkpoint'; END IF;
  r := '14bf2192-16de-442b-bf75-700f4ff2aace';
  PERFORM public.mobile_repair_pickup_payment_receipt(m,r,h,old_owner);
  UPDATE public.mobile_repair_pickup_payment_receipts SET claim_expires_at = now() - interval '1 day'
    WHERE merchant_id=m AND request_id=r;
  IF public.mobile_repair_pickup_payment_receipt_v2(m,r,h,new_owner)->>'state' <> 'pending'
  THEN RAISE EXCEPTION 'legacy execution reclaimed'; END IF;
  IF has_function_privilege('anon','public.begin_mobile_repair_pickup_payment(uuid,uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.begin_mobile_repair_pickup_payment(uuid,uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.begin_mobile_repair_pickup_payment(uuid,uuid,text,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'unexpected begin grant'; END IF;
END $$;
ROLLBACK;
