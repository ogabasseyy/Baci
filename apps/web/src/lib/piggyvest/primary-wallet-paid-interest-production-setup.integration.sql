\set ON_ERROR_STOP on
\ir primary-wallet-completion-notifications.integration.sql
ALTER TABLE public.customer_savings_goals ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN non_withdrawable_accepted_at timestamptz;
\ir ../../../../../supabase/migrations/20261007190000_piggyvest_primary_savings_provisioning.sql
\ir ../../../../../supabase/migrations/20261007220000_piggyvest_primary_interest_storage.sql
\ir ../../../../../supabase/migrations/20261007220001_piggyvest_primary_interest_evidence.sql
\if :{?without_primary_production_projection}
\else
\ir ../../../../../supabase/migrations/20261007220002_piggyvest_primary_interest_projection.sql
\endif
\if :{?without_primary_production_reads}
\else
\ir ../../../../../supabase/migrations/20261007220003_piggyvest_primary_interest_reads_notifications.sql
\endif

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE ROLE production_primary_interest_fixture LOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE production_primary_authorizer_fixture LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT piggyvest_primary_evidence TO production_primary_interest_fixture;
GRANT piggyvest_primary_authorizer TO production_primary_authorizer_fixture;
INSERT INTO piggyvest_primary.integrations VALUES('00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000001','prod-business','production','unused-production-provisioner',true);
INSERT INTO piggyvest_primary.inflow_authorities VALUES('00000000-0000-4000-8000-000000000005','production_primary_interest_fixture',true);
INSERT INTO piggyvest_primary.savings_authorities VALUES('00000000-0000-4000-8000-000000000005','production_primary_authorizer_fixture',true);
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',repeat('a',64),'verified','onboarding-customer-prod','production-primary');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount,terms_accepted_at,non_withdrawable_accepted_at)
SELECT pg_temp.goal_id(number),'00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','active',130,100,clock_timestamp()-interval '30 days',clock_timestamp()-interval '30 days'
FROM generate_series(45,48) number;
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(number),id,'production-api-wallet-'||number,true
FROM piggyvest_primary.onboarding_intents CROSS JOIN generate_series(45,48) number WHERE integration_id='00000000-0000-4000-8000-000000000005';
INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id,goal_id,primary_intent_id,wallet_name,state,provider_wallet_id,interest_accepted,interest_accepted_at)
SELECT integration_id,goal_id,intent_id,'baci-save:'||integration_id::text||':'||goal_id::text,'enrolled',provider_wallet_id,
  goal_id<>pg_temp.goal_id(46),CASE WHEN goal_id<>pg_temp.goal_id(46) THEN clock_timestamp()-interval '30 days' ELSE NULL END
FROM piggyvest_primary.savings_destinations WHERE integration_id='00000000-0000-4000-8000-000000000005';
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id,integration_id,goal_id,api_wallet_id,api_customer_id,onboarding_customer_id,
  webhook_customer_id,source_wallet_id,accrued_wallet_id,destination_wallet_id,envelope_destination_wallet_id,
  provider_evidence_sha256,policy_evidence_sha256,policy_reference,allocation_policy,enabled)
SELECT pg_temp.goal_id(number),'00000000-0000-4000-8000-000000000005',pg_temp.goal_id(number),'production-api-wallet-'||number,
  'prod-api-customer','onboarding-customer-prod','prod-webhook-customer','prod-source-interest','prod-accrued-interest',
  'prod-internal-destination-'||number,NULL,repeat('a',64),repeat('b',64),'synthetic-provider-and-owner-proof',
  'provider_net_is_customer_plan_interest',number<>47 FROM generate_series(45,48) number;

CREATE FUNCTION pg_temp.production_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('merchantId','00000000-0000-4000-8000-000000000001','customerId','00000000-0000-4000-8000-000000000002',
    'userId','00000000-0000-4000-8000-000000000003','integrationId','00000000-0000-4000-8000-000000000005',
    'businessId','prod-business','environment','production');
$$;
CREATE TEMP TABLE production_interest_proof AS SELECT jsonb_build_object(
  'payoutId','production-payout','webhookCustomerId','prod-webhook-customer','sourceWalletId','prod-source-interest',
  'accruedWalletId','prod-accrued-interest','destinationWalletId','prod-internal-destination-45','envelopeDestinationWalletId',NULL,
  'reference','prod-ref','envelopeReference','prod-envelope-ref','batchId','prod-batch','paidAt',clock_timestamp()-interval '5 minutes',
  'amountKobo',3000,'grossKobo',3158,'taxKobo',158,'netKobo',3000,'currency','NGN','crosswalkId',pg_temp.goal_id(45),
  'apiWalletId','production-api-wallet-45','apiCustomerId','prod-api-customer','businessId','prod-business',
  'eventId','prod-event','bodyDigest',repeat('b',64),'observedAt',clock_timestamp()) AS proof;
GRANT SELECT ON production_interest_proof TO production_primary_interest_fixture;
CREATE FUNCTION pg_temp.production_proof() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_set(proof,'{observedAt}',to_jsonb(clock_timestamp())) FROM production_interest_proof;
$$;
CREATE FUNCTION pg_temp.production_selection(number integer DEFAULT 45) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('webhookCustomerId','prod-webhook-customer','sourceWalletId','prod-source-interest',
    'accruedWalletId','prod-accrued-interest','destinationWalletId','prod-internal-destination-'||number,'envelopeDestinationWalletId',NULL);
$$;
CREATE FUNCTION pg_temp.production_apply(proof jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT piggyvest_primary.apply_paid_interest('00000000-0000-4000-8000-000000000005','production',proof);
$$;
CREATE FUNCTION pg_temp.production_goal_proof(number integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.production_proof()||jsonb_build_object('crosswalkId',pg_temp.goal_id(number),
    'apiWalletId','production-api-wallet-'||number,'destinationWalletId','prod-internal-destination-'||number,
    'payoutId','payout-'||number,'eventId','event-'||number);
$$;
SET SESSION AUTHORIZATION production_primary_interest_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.apply_inflow_environment('00000000-0000-4000-8000-000000000005','production',
  jsonb_build_object('eventId','prod-bank-event','providerTransactionId','prod-bank-transaction','providerCustomerId','onboarding-customer-prod',
    'providerWalletId','production-primary','eventDataId','prod-detail','amountKobo',10000,'feeKobo',100,'currency','NGN',
    'reference','prod-bank-ref','sessionId',NULL,'creditedAt',clock_timestamp(),
    'financialFingerprint',repeat('c',64),'bodyDigest',repeat('d',64)))='credited','Synthetic production bank funding is verified');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION production_primary_authorizer_fixture;
SELECT pg_temp.assert_true(piggyvest_primary.reserve_savings(pg_temp.production_scope(),jsonb_build_object(
  'goalId',pg_temp.goal_id(45),'operationId',pg_temp.goal_id(401),'amountKobo',3000))->>'status'='claimed','Principal-only remaining target can be reserved');
SELECT pg_temp.assert_true(piggyvest_primary.manage_savings(pg_temp.production_scope(),pg_temp.goal_id(401),'dispatch'),'Existing pending transfer is dispatched before payout');
RESET SESSION AUTHORIZATION;
CREATE TEMP TABLE production_cash_before AS SELECT available_balance,total_earned FROM public.customer_wallets;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
CREATE TEMP TABLE legacy_earnings_before AS SELECT public.get_customer_savings_earnings('00000000-0000-4000-8000-000000000001');
