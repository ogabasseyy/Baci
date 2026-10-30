BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','54619735-bd8f-4f7c-8db4-c57c5403038a',true);
DO $test$
DECLARE updated jsonb;
BEGIN
  updated:=public.set_customer_wallet_phone(
    '10000000-0000-4000-8000-000000000001',
    '54619735-bd8f-4f7c-8db4-c57c5403038a','08000007891');
  IF updated->>'id'<>'9e89a139-c098-4eac-a11b-8a3ea53e0e6e'
    OR updated->>'phone'<>'08000007891' THEN RAISE EXCEPTION 'Own phone save failed'; END IF;
  BEGIN
    PERFORM public.set_customer_wallet_phone('10000000-0000-4000-8000-000000000001',
      'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3','08000007892');
    RAISE EXCEPTION 'Another identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.set_customer_wallet_phone('00000000-0000-4000-8000-000000000000',
      '54619735-bd8f-4f7c-8db4-c57c5403038a','08000007892');
    RAISE EXCEPTION 'Another merchant accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.set_customer_wallet_phone('10000000-0000-4000-8000-000000000001',
      '54619735-bd8f-4f7c-8db4-c57c5403038a','invalid');
    RAISE EXCEPTION 'Invalid phone accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$test$;
RESET ROLE;
ROLLBACK;
