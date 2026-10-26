BEGIN;
SELECT set_config('test.recovery_scope', jsonb_build_object(
  'merchantId', customer.merchant_id, 'customerId', customer.id,
  'userId', customer.user_id, 'integrationId', binding.id,
  'environment', binding.environment, 'businessId', binding.business_id
)::text, true)
FROM public.customers customer
JOIN piggyvest_primary.integrations binding ON binding.merchant_id=customer.merchant_id
WHERE customer.id='9e89a139-c098-4eac-a11b-8a3ea53e0e6e';
SET SESSION AUTHORIZATION baci_piggyvest_primary_authorizer;
DO $test$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb; result jsonb; field text;
BEGIN
  result:=piggyvest_primary.read_pending_savings(scope,'39f53256-922e-4aa3-8c94-e68d878a6668');
  IF result IS NOT NULL THEN RAISE EXCEPTION 'Expected no pending transfer before onboarding'; END IF;
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_pending_savings(
        scope || jsonb_build_object(field, CASE WHEN field IN ('businessId','environment')
          THEN 'wrong-binding' ELSE '00000000-0000-4000-8000-000000000000' END),
        '39f53256-922e-4aa3-8c94-e68d878a6668');
      RAISE EXCEPTION 'Wrong binding was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(
      scope || jsonb_build_object('userId','00000000-0000-4000-8000-000000000000'),
      '39f53256-922e-4aa3-8c94-e68d878a6668');
    RAISE EXCEPTION 'Wrong user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'430314fd-cd8b-4579-98d4-e9f345713dd6');
    RAISE EXCEPTION 'Another customer goal was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.reserve_savings(scope,'{}'::jsonb);
    RAISE EXCEPTION 'Reservation before onboarding was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;
RESET SESSION AUTHORIZATION;
INSERT INTO piggyvest_primary.savings_operations (
  id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,
  destination_wallet_id,reference,state
)
SELECT '819c0ef5-95d2-44a9-836b-5cb567d45901',integration_id,intent_id,goal_id,
  amount_kobo,source_wallet_id,destination_wallet_id,'baci-recovery-regression-20261016','dispatched'
FROM piggyvest_primary.savings_operations WHERE goal_id IS NOT NULL LIMIT 1;
DO $fixture$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations
    WHERE id='819c0ef5-95d2-44a9-836b-5cb567d45901') THEN
    RAISE EXCEPTION 'Pending fixture missing';
  END IF;
END;
$fixture$;
SELECT set_config('test.pending_scope',jsonb_build_object(
  'merchantId',intent.merchant_id,'customerId',intent.customer_id,'userId',intent.user_id,
  'integrationId',binding.id,'environment',binding.environment,'businessId',binding.business_id
)::text,true),set_config('test.pending_goal',operation.goal_id::text,true)
FROM piggyvest_primary.savings_operations operation
JOIN piggyvest_primary.onboarding_intents intent ON intent.id=operation.intent_id
JOIN piggyvest_primary.integrations binding ON binding.id=intent.integration_id
WHERE operation.id='819c0ef5-95d2-44a9-836b-5cb567d45901';
SET SESSION AUTHORIZATION baci_piggyvest_primary_authorizer;
DO $pending$
DECLARE operation jsonb;
BEGIN
  operation:=piggyvest_primary.read_pending_savings(current_setting('test.pending_scope')::jsonb,
    current_setting('test.pending_goal')::uuid);
  IF operation IS NULL OR operation->>'state' NOT IN ('reserved','dispatched') THEN
    RAISE EXCEPTION 'Existing pending transfer was hidden';
  END IF;
END;
$pending$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
