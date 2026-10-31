-- Contract test: onboarding intents whose interest routing is not proven yet
-- (20261031230000_piggyvest_primary_onboarding_routing_pending.sql).
--
-- Proves, against live PostgreSQL:
--   * a dispatched intent can keep its provider ids as 'routing_pending', and
--     that state is never exposed as a usable wallet (read_onboarding NULL);
--   * claim_onboarding reports it pending and never re-dispatches creation;
--   * only the scoped owner's exact kept ids resolve it: proven routing makes
--     it 'accepted' (usable), a contradiction makes it 'rejected' (ids
--     cleared, terminal);
--   * stale claim tokens and mismatched ids change nothing;
--   * grants and shape, asserted through the catalog (a denied EXECUTE cannot
--     be trapped on the replay image, so no denial is probed by calling).
-- The calls run as the session role, registered as the integration executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_onboarding_routing_pending.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Customer n (1 or 2) of the fixture merchant.
CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3300000-0000-4000-8000-000000000002',
    'customerId', 'a3300000-0000-4000-8000-00000000001' || p_n,
    'userId', 'a3300000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3300000-0000-4000-8000-000000000005',
    'businessId', 'routing-pending-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.state(p_n int) RETURNS text LANGUAGE sql AS $$
  SELECT state || ':' || coalesce(provider_customer_id, '-') || ':' || coalesce(provider_wallet_id, '-')
  FROM piggyvest_primary.onboarding_intents
  WHERE integration_id = 'a3300000-0000-4000-8000-000000000005'
    AND customer_id = ('a3300000-0000-4000-8000-00000000001' || p_n)::uuid
$$;

CREATE FUNCTION pg_temp.ids(p_customer text, p_wallet text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('providerCustomerId', p_customer, 'providerWalletId', p_wallet)
$$;

-- Fixture: one merchant, two customers, one enabled integration. The
-- merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('a3300000-0000-4000-8000-000000000021'), ('a3300000-0000-4000-8000-000000000022');
INSERT INTO public.merchants(id, email)
  VALUES ('a3300000-0000-4000-8000-000000000002', 'routing-pending@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a3300000-0000-4000-8000-000000000011', 'a3300000-0000-4000-8000-000000000002',
   'a3300000-0000-4000-8000-000000000021'),
  ('a3300000-0000-4000-8000-000000000012', 'a3300000-0000-4000-8000-000000000002',
   'a3300000-0000-4000-8000-000000000022');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3300000-0000-4000-8000-000000000005', 'a3300000-0000-4000-8000-000000000002',
    'routing-pending-business', 'staging', session_user, true);
CREATE TEMP TABLE claims(n int PRIMARY KEY, intent uuid, token uuid);

-- 1. A routing-pending wallet keeps its ids, is not usable, and a repeated
--    setup request never re-dispatches creation.
DO $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('c', 64));
  PERFORM pg_temp.check(v_claim->>'status' = 'claimed', 'fresh onboarding not claimed');
  INSERT INTO claims VALUES (1, (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid);
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(1),
    (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid, 'pv-customer-1', 'pv-wallet-1'),
    'routing-pending ids not recorded');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'ids not kept: ' || pg_temp.state(1));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(1)) IS NULL,
    'a routing-pending wallet must not be exposed as usable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(1)) = pg_temp.ids('pv-customer-1', 'pv-wallet-1'),
    'the kept ids must be readable for recovery');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('c', 64)) = '{"status":"pending"}'::jsonb,
    'a routing-pending intent must report pending and never be re-claimed');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'a repeated claim changed the intent');
END $$;

-- 2. Stale tokens, another customer's scope and mismatched ids change nothing.
DO $$
DECLARE v_claim claims%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_claim FROM claims WHERE n = 1;
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(1),
    v_claim.intent, v_claim.token, 'pv-customer-x', 'pv-wallet-x'), 'a spent claim token re-recorded ids');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-other'), true), 'mismatched ids resolved the intent');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(2)) IS NULL,
    'another customer read the kept ids');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), true), 'another customer resolved the intent');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'a refused call changed the intent');
END $$;

-- 3. Proven routing makes the kept wallet usable, exactly once.
DO $$
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), true), 'proven routing did not resolve');
  PERFORM pg_temp.check(pg_temp.state(1) = 'accepted:pv-customer-1:pv-wallet-1', 'not accepted: ' || pg_temp.state(1));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(1)) = pg_temp.ids('pv-customer-1', 'pv-wallet-1'),
    'the accepted wallet must be readable as usable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(1)) IS NULL,
    'an accepted wallet is no longer routing pending');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), false), 'an accepted wallet was resolved again');
END $$;

-- 4. A contradicted routing is terminal review: ids cleared, never re-claimed.
DO $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('d', 64));
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(2),
    (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid, 'pv-customer-2', 'pv-wallet-2'),
    'second routing-pending ids not recorded');
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    pg_temp.ids('pv-customer-2', 'pv-wallet-2'), false), 'a contradicted routing did not resolve');
  PERFORM pg_temp.check(pg_temp.state(2) = 'rejected:-:-', 'not rejected with cleared ids: ' || pg_temp.state(2));
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('d', 64)) = '{"status":"conflict"}'::jsonb,
    'a rejected routing must stay in review');
END $$;

-- 5. Shape, constraints and grants, through the catalog only.
DO $$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  PERFORM pg_temp.check(
    (SELECT count(*) FROM pg_catalog.pg_constraint
     WHERE conrelid = 'piggyvest_primary.onboarding_intents'::regclass AND contype = 'c'
       AND pg_catalog.pg_get_constraintdef(oid) LIKE '%routing_pending%') = 2,
    'routing_pending must be in both the state and the coherence checks');
  FOREACH v_fn IN ARRAY ARRAY[
    'piggyvest_primary.record_onboarding_routing_pending(jsonb,uuid,uuid,text,text)'::regprocedure,
    'piggyvest_primary.read_onboarding_routing(jsonb)'::regprocedure,
    'piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean)'::regprocedure
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
        v_role || ' can execute ' || v_fn::text);
    END LOOP;
    PERFORM pg_temp.check(
      pg_catalog.has_function_privilege('piggyvest_primary_provisioner', v_fn, 'EXECUTE'),
      'the onboarding provisioner lacks EXECUTE on ' || v_fn::text);
    PERFORM pg_temp.check(
      (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
       FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
      v_fn::text || ' must be SECURITY DEFINER with a pinned search_path');
  END LOOP;
END $$;

ROLLBACK;
