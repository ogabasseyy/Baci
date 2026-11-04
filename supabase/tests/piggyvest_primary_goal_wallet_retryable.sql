-- Contract test: piggyvest_primary.read_goal_wallet reports setupRetryable
-- (20261104090000_piggyvest_primary_goal_wallet_retryable.sql).
--
-- Proves, against live PostgreSQL, that a status read invites a setup retry
-- exactly when prepare_goal_wallet would re-claim the intent:
--   * a live claim (dispatched or unknown, written under five minutes ago)
--     is not retryable and a read does not change it;
--   * an expired dispatched or unknown claim is retryable, still reads
--     pending, and a read claims nothing (the claim token is unchanged);
--   * after prepare re-claims it the flag is false again (live claim);
--   * an accepted intent is never retryable, however old.
--   * grants are unchanged, asserted through the catalog.
-- The calls run as the session role, registered as the goal executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_goal_wallet_retryable.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Integration and first goal use the ids of the TypeScript golden test.
CREATE FUNCTION pg_temp.goal(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.scope() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a4200000-0000-4000-8000-000000000002',
    'customerId', 'a4200000-0000-4000-8000-000000000003',
    'userId', 'a4200000-0000-4000-8000-000000000001',
    'integrationId', '00000000-0000-4000-8000-000000000004',
    'businessId', 'retryable-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.prepare(p_goal uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.prepare_goal_wallet(pg_temp.scope(), p_goal, false)
$$;

CREATE FUNCTION pg_temp.read(p_goal uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.read_goal_wallet(pg_temp.scope(), p_goal)
$$;

CREATE FUNCTION pg_temp.age(p_goal uuid, p_minutes int) RETURNS void LANGUAGE sql AS $$
  UPDATE piggyvest_primary.goal_wallet_intents
  SET updated_at = pg_catalog.clock_timestamp() - make_interval(mins => p_minutes)
  WHERE integration_id = '00000000-0000-4000-8000-000000000004' AND goal_id = p_goal
$$;

CREATE FUNCTION pg_temp.token(p_goal uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT claim_token FROM piggyvest_primary.goal_wallet_intents
  WHERE integration_id = '00000000-0000-4000-8000-000000000004' AND goal_id = p_goal
$$;

-- Fixture: a verified primary wallet and three active goals for one customer.
-- The merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('a4200000-0000-4000-8000-000000000001');
INSERT INTO public.merchants(id, email)
  VALUES ('a4200000-0000-4000-8000-000000000002', 'retryable@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a4200000-0000-4000-8000-000000000003', 'a4200000-0000-4000-8000-000000000002',
   'a4200000-0000-4000-8000-000000000001');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity) VALUES
  ('a4200000-0000-4000-8000-000000000004', 'a4200000-0000-4000-8000-000000000002',
   'Retryable device', 100000, 'active', 3);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.goal(n), 'a4200000-0000-4000-8000-000000000002',
  'a4200000-0000-4000-8000-000000000003', 'a4200000-0000-4000-8000-000000000004',
  'Retryable goal ' || n, 'active', 'manual', 100000, 0, 20000, 'daily',
  current_date, current_date + 30, now(), now()
FROM generate_series(6, 11) AS n;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('00000000-0000-4000-8000-000000000004', 'a4200000-0000-4000-8000-000000000002',
    'retryable-business', 'staging', 'retryable_fixture_executor', true);
INSERT INTO piggyvest_primary.goal_provisioning_authorities(integration_id, executor_login, enabled)
  VALUES ('00000000-0000-4000-8000-000000000004', session_user, true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES ('a4200000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004',
    'a4200000-0000-4000-8000-000000000002', 'a4200000-0000-4000-8000-000000000003',
    'a4200000-0000-4000-8000-000000000001', repeat('b', 64), 'verified',
    'pv-customer', 'pv-primary-wallet');


-- 1. A live dispatched claim is pending and not retryable.
DO $$
BEGIN
  PERFORM pg_temp.prepare(pg_temp.goal(6));
  PERFORM pg_temp.check(pg_temp.read(pg_temp.goal(6))->>'status' = 'pending', 'live claim must read pending');
  PERFORM pg_temp.check((pg_temp.read(pg_temp.goal(6))->>'setupRetryable')::boolean IS NOT DISTINCT FROM false,
    'a live dispatched claim must not be retryable');
  PERFORM pg_temp.age(pg_temp.goal(6), 4);
  PERFORM pg_temp.check((pg_temp.read(pg_temp.goal(6))->>'setupRetryable')::boolean IS NOT DISTINCT FROM false,
    'a claim under five minutes old must not be retryable');
END $$;

-- 2. An expired dispatched claim is retryable; the read claims nothing.
DO $$
DECLARE v_token uuid := pg_temp.token(pg_temp.goal(6)); v_read jsonb;
BEGIN
  PERFORM pg_temp.age(pg_temp.goal(6), 6);
  v_read := pg_temp.read(pg_temp.goal(6));
  PERFORM pg_temp.check(v_read->>'status' = 'pending', 'an expired claim still reads pending');
  PERFORM pg_temp.check((v_read->>'setupRetryable')::boolean IS NOT DISTINCT FROM true,
    'an expired dispatched claim must be retryable');
  PERFORM pg_temp.check(v_read->>'claimToken' IS NULL AND pg_temp.token(pg_temp.goal(6)) = v_token,
    'a status read must not claim or expose a token');
END $$;

-- 3. prepare re-claims it; the fresh claim is live and not retryable.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.prepare(pg_temp.goal(6))->>'status' = 'claimed',
    'an expired claim must be re-claimed by prepare');
  PERFORM pg_temp.check((pg_temp.read(pg_temp.goal(6))->>'setupRetryable')::boolean IS NOT DISTINCT FROM false,
    'a re-claimed intent must not be retryable');
END $$;

-- 4. An unknown outcome: fresh is not retryable, expired is.
DO $$
DECLARE v_goal uuid := pg_temp.goal(7);
BEGIN
  PERFORM pg_temp.prepare(v_goal);
  PERFORM pg_temp.check(
    piggyvest_primary.record_goal_wallet(pg_temp.scope(), v_goal, pg_temp.token(v_goal), NULL),
    'unknown outcome not recorded');
  PERFORM pg_temp.check((pg_temp.read(v_goal)->>'setupRetryable')::boolean IS NOT DISTINCT FROM false,
    'a fresh unknown outcome must not be retryable');
  PERFORM pg_temp.age(v_goal, 6);
  PERFORM pg_temp.check((pg_temp.read(v_goal)->>'setupRetryable')::boolean IS NOT DISTINCT FROM true,
    'an expired unknown outcome must be retryable');
END $$;

-- 5. An accepted intent is never retryable, however old.
DO $$
DECLARE v_goal uuid := pg_temp.goal(8);
BEGIN
  PERFORM pg_temp.prepare(v_goal);
  PERFORM pg_temp.check(
    piggyvest_primary.record_goal_wallet(pg_temp.scope(), v_goal, pg_temp.token(v_goal), 'retryable-wallet'),
    'accepted outcome not recorded');
  PERFORM pg_temp.age(v_goal, 60);
  PERFORM pg_temp.check(pg_temp.read(v_goal)->>'status' = 'pending'
    AND (pg_temp.read(v_goal)->>'setupRetryable')::boolean IS NOT DISTINCT FROM false,
    'an accepted intent must stay pending and not retryable');
END $$;

-- 6. A goal with no setup record still reads NULL.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.read(pg_temp.goal(9)) IS NULL, 'an unstarted goal must read NULL');
END $$;

-- 7. Grants are unchanged and the function stays pinned.
DO $$
DECLARE
  v_fn regprocedure := 'piggyvest_primary.read_goal_wallet(jsonb,uuid)'::regprocedure;
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
      v_role || ' can execute read_goal_wallet');
  END LOOP;
  PERFORM pg_temp.check(
    pg_catalog.has_function_privilege('piggyvest_primary_goal_provisioner', v_fn, 'EXECUTE'),
    'the goal provisioner lost EXECUTE on read_goal_wallet');
  PERFORM pg_temp.check(
    (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
     FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
    'read_goal_wallet must stay SECURITY DEFINER with a pinned search_path');
END $$;

ROLLBACK;
