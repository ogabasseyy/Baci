BEGIN;
INSERT INTO public.merchants(id, email, business_name, slug, is_published)
VALUES ('14bf2192-16de-442b-bf75-700f4ff2aaca', 'receipt-test@example.com', 'Receipt Test', 'receipt-test-3448', true);
SET LOCAL ROLE repair_pickup_receiver;
SELECT set_config('request.jwt.claims', '{"role":"repair_pickup_receiver","repair_pickup_receiver_context":"server-payment-start","repair_pickup_receiver_merchant_id":"14bf2192-16de-442b-bf75-700f4ff2aaca"}', true);
DO $$
DECLARE
  m uuid := '14bf2192-16de-442b-bf75-700f4ff2aaca';
  r uuid := '14bf2192-16de-442b-bf75-700f4ff2aacb';
  owner_id uuid := '14bf2192-16de-442b-bf75-700f4ff2aacc';
  other_id uuid := '14bf2192-16de-442b-bf75-700f4ff2aacd';
  h text := repeat('a', 64);
  response jsonb := '{"success":false,"code":"test","error":"test"}';
BEGIN
  IF public.mobile_repair_pickup_payment_receipt(m,r,h,owner_id)->>'state' <> 'claimed' THEN RAISE EXCEPTION 'first claim failed'; END IF;
  IF public.mobile_repair_pickup_payment_receipt(m,r,h,other_id)->>'state' <> 'pending' THEN RAISE EXCEPTION 'retry reclaimed unknown request'; END IF;
  BEGIN
    PERFORM public.mobile_repair_pickup_payment_receipt(m,r,repeat('b',64),other_id);
    RAISE EXCEPTION 'changed input accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.mobile_repair_pickup_payment_receipt(m,r,h,other_id,response);
    RAISE EXCEPTION 'non-owner completed request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.mobile_repair_pickup_payment_receipt(m,r,h,owner_id,response);
  IF public.mobile_repair_pickup_payment_receipt(m,r,h,other_id)->'result' IS DISTINCT FROM response THEN RAISE EXCEPTION 'lost response not replayed'; END IF;
  PERFORM set_config('request.jwt.claims', '{"repair_pickup_receiver_context":"server-quote","repair_pickup_receiver_merchant_id":"14bf2192-16de-442b-bf75-700f4ff2aaca"}', true);
  BEGIN
    PERFORM public.mobile_repair_pickup_payment_receipt(m,r,h,owner_id);
    RAISE EXCEPTION 'quote context read payment response';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"repair_pickup_receiver_context":"server-payment-start","repair_pickup_receiver_merchant_id":"14bf2192-16de-442b-bf75-700f4ff2aacd"}', true);
  BEGIN
    PERFORM public.mobile_repair_pickup_payment_receipt(m,r,h,owner_id);
    RAISE EXCEPTION 'cross tenant read payment response';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,'public.mobile_repair_pickup_payment_receipt(uuid,uuid,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'unexpected RPC grant'; END IF;
  END LOOP;
  IF has_table_privilege('repair_pickup_receiver','public.mobile_repair_pickup_payment_receipts','SELECT') THEN RAISE EXCEPTION 'direct table access'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.mobile_repair_pickup_payment_receipts'::regclass) THEN RAISE EXCEPTION 'RLS missing'; END IF;
END $$;
ROLLBACK;
