-- Contract tests for durable ownership/routing review evidence and its
-- customer-deletion boundary (20261101171000).
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3900000-0000-4000-8000-000000000002',
    'customerId', 'a3900000-0000-4000-8000-00000000001' || p_n,
    'userId', 'a3900000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3900000-0000-4000-8000-000000000005',
    'businessId', 'onboarding-recovery-business',
    'environment', 'staging')
$$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('a3900000-0000-4000-8000-000000000021'), ('a3900000-0000-4000-8000-000000000022'),
  ('a3900000-0000-4000-8000-000000000023'), ('a3900000-0000-4000-8000-000000000024'),
  ('a3900000-0000-4000-8000-000000000025'), ('a3900000-0000-4000-8000-000000000026'),
  ('a3900000-0000-4000-8000-000000000027'), ('a3900000-0000-4000-8000-000000000028'),
  ('a3900000-0000-4000-8000-000000000029');
INSERT INTO public.merchants(id, email)
  VALUES ('a3900000-0000-4000-8000-000000000002', 'onboarding-recovery@example.test');
INSERT INTO public.customers(id, merchant_id, user_id, email) VALUES
  ('a3900000-0000-4000-8000-000000000011', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000021', 'review-1@example.test'),
  ('a3900000-0000-4000-8000-000000000012', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000022', 'review-2@example.test'),
  ('a3900000-0000-4000-8000-000000000013', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000023', 'review-3@example.test'),
  ('a3900000-0000-4000-8000-000000000014', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000024', 'review-4@example.test'),
  ('a3900000-0000-4000-8000-000000000015', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000025', 'review-5@example.test'),
  ('a3900000-0000-4000-8000-000000000016', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000026', 'review-6@example.test'),
  ('a3900000-0000-4000-8000-000000000017', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000027', 'review-7@example.test'),
  ('a3900000-0000-4000-8000-000000000018', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000028', 'review-8@example.test'),
  ('a3900000-0000-4000-8000-000000000019', 'a3900000-0000-4000-8000-000000000002', 'a3900000-0000-4000-8000-000000000029', 'review-9@example.test');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3900000-0000-4000-8000-000000000005', 'a3900000-0000-4000-8000-000000000002',
    'onboarding-recovery-business', 'staging', session_user, true);

DO $$
DECLARE c jsonb; intent_id uuid;
BEGIN
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'new customer offered recovery');
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a',64));
  intent_id := (c->>'intentId')::uuid;
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'live claim offered recovery');
  PERFORM piggyvest_primary.record_onboarding(pg_temp.scope(1), intent_id, (c->>'claimToken')::uuid, NULL, NULL);
  PERFORM pg_temp.check(piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'unknown creation cannot recover');
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a',64));
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'active reclaim offered recovery');
  UPDATE piggyvest_primary.onboarding_intents SET updated_at = clock_timestamp() - interval '6 minutes' WHERE id = intent_id;
  PERFORM pg_temp.check(piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'expired dispatch cannot recover');
  PERFORM piggyvest_primary.record_onboarding_ownership_hold(pg_temp.scope(1), intent_id, (c->>'claimToken')::uuid);
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(1)), 'ownership hold offered retry');
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('b',64));
  PERFORM piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(2), (c->>'intentId')::uuid,
    (c->>'claimToken')::uuid, 'recovery-customer-2', 'recovery-wallet-2', '01JBZ8Q5W3X9R2K4M6N8P0T2V4');
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(2)), 'mapped routing pending offered retry');
  PERFORM piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    jsonb_build_object('providerCustomerId','recovery-customer-2','providerWalletId','recovery-wallet-2'), false, 'routing');
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(2)), 'routing review offered retry');
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(3), repeat('c',64));
  PERFORM piggyvest_primary.record_onboarding(pg_temp.scope(3), (c->>'intentId')::uuid,
    (c->>'claimToken')::uuid, 'recovery-customer-3', 'recovery-wallet-3');
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(3)), 'accepted wallet offered retry');
  PERFORM pg_temp.check(piggyvest_primary.verify_onboarding(pg_temp.scope(3), jsonb_build_object(
    'providerCustomerId','recovery-customer-3','providerWalletId','recovery-wallet-3',
    'businessId','onboarding-recovery-business','currency','NGN','status','active','hasFundingAccount',true)),
    'verified recovery fixture failed');
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(3)), 'verified wallet offered retry');
  PERFORM pg_temp.check(NOT piggyvest_primary.can_recover_onboarding(pg_temp.scope(4)), 'missing intent offered retry');
  BEGIN
    PERFORM piggyvest_primary.can_recover_onboarding(pg_temp.scope(1) || jsonb_build_object('userId', 'a3900000-0000-4000-8000-000000000029'));
    RAISE EXCEPTION 'cross-user recovery disclosed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(principal, 'piggyvest_primary.can_recover_onboarding(jsonb)', 'EXECUTE'), 'untrusted recovery read grant');
  END LOOP;
  PERFORM pg_temp.check(has_function_privilege('piggyvest_primary_provisioner', 'piggyvest_primary.can_recover_onboarding(jsonb)', 'EXECUTE'), 'provisioner recovery read absent');
END $$;
ROLLBACK;
