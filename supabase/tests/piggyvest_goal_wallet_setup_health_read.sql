-- Contract test for piggyvest_primary.read_goal_wallet_setup_health: it counts
-- only goal-wallet setups that are not enrolled and started more than
-- staleAfterSeconds ago (created_at), changes nothing, refuses a wrong
-- binding or malformed options, and the catalog shows a pinned SECURITY
-- DEFINER function whose EXECUTE reaches only the evidence role. Privileges
-- are asserted through the catalog, never by calling and catching a denial.
-- Synthetic, transaction-local fixture.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_goal_wallet_setup_health_read.sql
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.goal(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('a4300000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('a4300000-0000-4000-8000-000000000001');
INSERT INTO public.merchants(id, email)
  VALUES ('a4300000-0000-4000-8000-000000000002', 'goal-health@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a4300000-0000-4000-8000-000000000003', 'a4300000-0000-4000-8000-000000000002',
   'a4300000-0000-4000-8000-000000000001');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity) VALUES
  ('a4300000-0000-4000-8000-000000000004', 'a4300000-0000-4000-8000-000000000002',
   'Goal health device', 100000, 'active', 3);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.goal(n), 'a4300000-0000-4000-8000-000000000002',
  'a4300000-0000-4000-8000-000000000003', 'a4300000-0000-4000-8000-000000000004',
  'Goal health ' || n, 'active', 'manual', 100000, 0, 20000, 'daily',
  current_date, current_date + 30, now(), now()
FROM generate_series(10, 15) AS n;
-- Goal 16 was cancelled while its setup was pending: never counted as stuck.
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
VALUES (pg_temp.goal(16), 'a4300000-0000-4000-8000-000000000002',
  'a4300000-0000-4000-8000-000000000003', 'a4300000-0000-4000-8000-000000000004',
  'Goal health 16', 'cancelled', 'manual', 100000, 0, 20000, 'daily',
  current_date, current_date + 30, now(), now());
-- An earlier replay check may have left an integration bound to this login
-- (executor_login is unique): retire it inside this rolled-back transaction.
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = SESSION_USER;
UPDATE piggyvest_primary.inflow_authorities SET executor_login = 'retired-' || integration_id::text
  WHERE executor_login = SESSION_USER;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a4300000-0000-4000-8000-000000000005', 'a4300000-0000-4000-8000-000000000002',
    'goal-health-business', 'staging', session_user, true);
INSERT INTO piggyvest_primary.inflow_authorities(integration_id, executor_login, enabled)
  VALUES ('a4300000-0000-4000-8000-000000000005', session_user, true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES ('a4300000-0000-4000-8000-000000000006', 'a4300000-0000-4000-8000-000000000005',
    'a4300000-0000-4000-8000-000000000002', 'a4300000-0000-4000-8000-000000000003',
    'a4300000-0000-4000-8000-000000000001', repeat('c', 64), 'verified',
    'pv-customer', 'pv-primary-wallet');

-- Seven setups: 10 old unknown, 11 old dispatched, 12 old accepted (all stalled);
-- 13 old enrolled (done); 14 fresh unknown, 15 fresh dispatched (too young);
-- 16 old unknown on a cancelled goal (excluded).
INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id, goal_id, primary_intent_id, wallet_name,
  state, claim_token, provider_wallet_id, interest_accepted, created_at, updated_at)
SELECT 'a4300000-0000-4000-8000-000000000005', pg_temp.goal(s.n), 'a4300000-0000-4000-8000-000000000006',
  'goal-health-' || s.n, s.state,
  CASE WHEN s.state = 'dispatched' THEN pg_catalog.gen_random_uuid() END,
  CASE WHEN s.state IN ('accepted', 'enrolled') THEN 'pv-wallet-' || s.n END,
  false,
  pg_catalog.clock_timestamp() - make_interval(mins => s.age_minutes),
  pg_catalog.clock_timestamp()
FROM (VALUES (10, 'unknown', 30), (11, 'dispatched', 30), (12, 'accepted', 30),
  (13, 'enrolled', 30), (14, 'unknown', 2), (15, 'dispatched', 2),
  (16, 'unknown', 30)) AS s(n, state, age_minutes)
;

DO $$
DECLARE
  integration constant uuid := 'a4300000-0000-4000-8000-000000000005';
  v_read jsonb;
  v_before bigint;
  v_bad text;
BEGIN
  -- Not enrolled and older than the cutoff: 10, 11, 12. Enrolled (13) and
  -- fresh (14, 15) setups are not counted.
  v_before := (SELECT count(*) FROM piggyvest_primary.goal_wallet_intents);
  v_read := piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging', '{"staleAfterSeconds":600}');
  PERFORM pg_temp.check((v_read->>'stalledGoalWallets')::int = 3, 'stalled count must be 3, got ' || (v_read->>'stalledGoalWallets'));
  PERFORM pg_temp.check((v_read->>'staleAfterSeconds')::int = 600, 'cutoff must be echoed');
  -- Aggregate only: no ids or customer data in the payload.
  PERFORM pg_temp.check((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_read) k)
    = ARRAY['generatedAt', 'staleAfterSeconds', 'stalledGoalWallets'], 'payload must carry only the aggregate');
  -- A wider cutoff excludes the 30-minute-old setups; a narrower one adds the fresh ones.
  PERFORM pg_temp.check((piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging',
    '{"staleAfterSeconds":3600}')->>'stalledGoalWallets')::int = 0, 'a one-hour cutoff must count none');
  PERFORM pg_temp.check((piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging',
    '{"staleAfterSeconds":60}')->>'stalledGoalWallets')::int = 5, 'a one-minute cutoff must count the five unenrolled');
  PERFORM pg_temp.check((SELECT count(*) FROM piggyvest_primary.goal_wallet_intents) = v_before, 'read must change nothing');
  -- Age counts from created_at: a refreshed updated_at must not hide a stalled setup.
  UPDATE piggyvest_primary.goal_wallet_intents SET updated_at = pg_catalog.clock_timestamp()
    WHERE goal_id = pg_temp.goal(10);
  PERFORM pg_temp.check((piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging',
    '{"staleAfterSeconds":600}')->>'stalledGoalWallets')::int = 3, 'updated_at must not reset the age');
  -- Malformed options are refused, never defaulted.
  FOREACH v_bad IN ARRAY ARRAY['{}', '[]', '{"staleAfterSeconds":"600"}', '{"staleAfterSeconds":59}',
    '{"staleAfterSeconds":86401}', '{"staleAfterSeconds":600,"x":1}', '{"staleAfterSeconds":1.5}', 'null'] LOOP
    BEGIN
      PERFORM piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging', v_bad::jsonb);
      RAISE EXCEPTION 'Options % were accepted', v_bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  -- Wrong environment, or a disabled authority, has no authority.
  BEGIN
    PERFORM piggyvest_primary.read_goal_wallet_setup_health(integration, 'production', '{"staleAfterSeconds":600}');
    RAISE EXCEPTION 'Wrong environment was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.inflow_authorities SET enabled = false WHERE integration_id = integration;
  BEGIN
    PERFORM piggyvest_primary.read_goal_wallet_setup_health(integration, 'staging', '{"staleAfterSeconds":600}');
    RAISE EXCEPTION 'Disabled authority was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Catalog: pinned SECURITY DEFINER, VOLATILE; EXECUTE reaches only the evidence role.
DO $catalog$
DECLARE routine regprocedure := 'piggyvest_primary.read_goal_wallet_setup_health(uuid,text,jsonb)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = routine) THEN
    RAISE EXCEPTION 'read_goal_wallet_setup_health is not SECURITY DEFINER';
  END IF;
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = routine)
    IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'read_goal_wallet_setup_health search_path is not pinned';
  END IF;
  -- It reads the wall clock (clock_timestamp()), so VOLATILE.
  IF (SELECT provolatile FROM pg_catalog.pg_proc WHERE oid = routine) <> 'v' THEN
    RAISE EXCEPTION 'read_goal_wallet_setup_health is not VOLATILE';
  END IF;
  IF (SELECT array_agg(grantee_name ORDER BY grantee_name) FROM (
      SELECT DISTINCT CASE WHEN privilege.grantee = 0 THEN 'PUBLIC'
        ELSE grantee_role.rolname::text END AS grantee_name
      FROM pg_catalog.pg_proc routine_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(routine_row.proacl,
        pg_catalog.acldefault('f', routine_row.proowner))) privilege
      LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = privilege.grantee
      WHERE routine_row.oid = routine AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> routine_row.proowner) grantees)
    IS DISTINCT FROM ARRAY['piggyvest_primary_evidence'] THEN
    RAISE EXCEPTION 'read_goal_wallet_setup_health EXECUTE reaches roles beyond the evidence role';
  END IF;
  -- The scan's partial index: not-yet-enrolled setups by integration and age.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'piggyvest_primary'
      AND tablename = 'goal_wallet_intents'
      AND indexname = 'piggyvest_primary_goal_wallet_intents_unenrolled_idx'
      AND indexdef LIKE '%(integration_id, created_at)%'
      AND indexdef LIKE '%WHERE%enrolled%'
  ) THEN
    RAISE EXCEPTION 'stalled-setup scan index is missing or changed';
  END IF;
END;
$catalog$;
ROLLBACK;
