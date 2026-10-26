BEGIN;
SELECT set_config('test.scope',jsonb_build_object('merchantId',customer.merchant_id,
  'customerId',customer.id,'userId',customer.user_id,'integrationId',binding.id,
  'businessId',binding.business_id,'environment',binding.environment)::text,true)
FROM public.customers customer JOIN piggyvest_primary.integrations binding ON binding.merchant_id=customer.merchant_id
WHERE customer.id='9e89a139-c098-4eac-a11b-8a3ea53e0e6e';
SET SESSION AUTHORIZATION baci_piggyvest_primary_provisioner;
DO $test$
BEGIN
  IF piggyvest_primary.has_onboarding(current_setting('test.scope')::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Never-started account was reported pending';
  END IF;
  BEGIN
    PERFORM piggyvest_primary.has_onboarding(current_setting('test.scope')::jsonb ||
      jsonb_build_object('userId','00000000-0000-4000-8000-000000000000'));
    RAISE EXCEPTION 'Foreign user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
