-- Transaction-local synthetic identities; never depend on staging customer rows.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('f3820000-0000-4000-8000-000000000001', 'wallet-phone-owner@example.test'),
  ('f3820000-0000-4000-8000-000000000011', 'wallet-phone-other@example.test');
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'f3820000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
  ('f3820000-0000-4000-8000-000000000002', 'f3820000-0000-4000-8000-000000000001',
   'wallet-phone-owner@example.test', 'Wallet phone fixture', 'wallet-phone-fixture');
INSERT INTO public.customers (id, merchant_id, user_id, email, phone) VALUES
  ('f3820000-0000-4000-8000-000000000003', 'f3820000-0000-4000-8000-000000000002',
   'f3820000-0000-4000-8000-000000000001', 'wallet-phone-owner@example.test', '08000007890'),
  ('f3820000-0000-4000-8000-000000000012', 'f3820000-0000-4000-8000-000000000002',
   'f3820000-0000-4000-8000-000000000011', 'wallet-phone-other@example.test', '08000007893');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f3820000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE updated jsonb;
BEGIN
  updated:=public.set_customer_wallet_phone(
    'f3820000-0000-4000-8000-000000000002',
    'f3820000-0000-4000-8000-000000000001','08000007891');
  IF updated->>'id' IS DISTINCT FROM 'f3820000-0000-4000-8000-000000000003'
    OR updated->>'phone' IS DISTINCT FROM '08000007891' THEN RAISE EXCEPTION 'Own phone save failed'; END IF;
  BEGIN
    PERFORM public.set_customer_wallet_phone('f3820000-0000-4000-8000-000000000002',
      'f3820000-0000-4000-8000-000000000011','08000007892');
    RAISE EXCEPTION 'Another identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.set_customer_wallet_phone('00000000-0000-4000-8000-000000000000',
      'f3820000-0000-4000-8000-000000000001','08000007892');
    RAISE EXCEPTION 'Another merchant accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.set_customer_wallet_phone('f3820000-0000-4000-8000-000000000002',
      'f3820000-0000-4000-8000-000000000001','invalid');
    RAISE EXCEPTION 'Invalid phone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$test$;
RESET ROLE;
DO $test$ BEGIN
  IF (SELECT phone FROM public.customers
      WHERE id='f3820000-0000-4000-8000-000000000012') IS DISTINCT FROM '08000007893' THEN
    RAISE EXCEPTION 'Another customer phone changed';
  END IF;
END; $test$;
ROLLBACK;
