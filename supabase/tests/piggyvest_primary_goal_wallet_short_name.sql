-- Contract test: piggyvest_primary.prepare_goal_wallet names goal wallets
-- within PiggyVest's 50-character subaccount_name limit
-- (20261031221500_piggyvest_primary_goal_wallet_short_name.sql).
--
-- Proves, against live PostgreSQL:
--   * a new goal wallet is named 'baci-save-' plus 32 hex characters of
--     sha256('<integration>:<goal>'), exactly the name
--     buildPrimaryGoalWalletName returns for the same ids (pinned on both
--     sides: apps/web/src/lib/piggyvest/primary-goal-wallet-name.test.ts);
--   * names are at most 50 characters, distinct per goal, stored on the
--     intent, and kept when a stale intent is re-claimed;
--   * the wallet-name immutability trigger is enabled again after the
--     migration's one-time rename;
--   * grants are unchanged, asserted through the catalog (a denied EXECUTE
--     cannot be trapped on the replay image, so no denial is probed by
--     calling the function).
-- The calls run as the session role, registered as the goal executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_goal_wallet_short_name.sql

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
    'merchantId', 'a3200000-0000-4000-8000-000000000002',
    'customerId', 'a3200000-0000-4000-8000-000000000003',
    'userId', 'a3200000-0000-4000-8000-000000000001',
    'integrationId', '00000000-0000-4000-8000-000000000004',
    'businessId', 'short-name-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.prepare(p_goal uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_primary.prepare_goal_wallet(pg_temp.scope(), p_goal, false)
$$;

CREATE FUNCTION pg_temp.stored(p_goal uuid) RETURNS text LANGUAGE sql AS $$
  SELECT wallet_name FROM piggyvest_primary.goal_wallet_intents
  WHERE integration_id = '00000000-0000-4000-8000-000000000004' AND goal_id = p_goal
$$;

-- Fixture: a verified primary wallet and three active goals for one customer.
-- The merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('a3200000-0000-4000-8000-000000000001');
INSERT INTO public.merchants(id, email)
  VALUES ('a3200000-0000-4000-8000-000000000002', 'short-name@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a3200000-0000-4000-8000-000000000003', 'a3200000-0000-4000-8000-000000000002',
   'a3200000-0000-4000-8000-000000000001');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity) VALUES
  ('a3200000-0000-4000-8000-000000000004', 'a3200000-0000-4000-8000-000000000002',
   'Short name device', 100000, 'active', 3);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.goal(n), 'a3200000-0000-4000-8000-000000000002',
  'a3200000-0000-4000-8000-000000000003', 'a3200000-0000-4000-8000-000000000004',
  'Short name goal ' || n, 'active', 'manual', 100000, 0, 20000, 'daily',
  current_date, current_date + 30, now(), now()
FROM generate_series(6, 8) AS n;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('00000000-0000-4000-8000-000000000004', 'a3200000-0000-4000-8000-000000000002',
    'short-name-business', 'staging', 'short_name_fixture_executor', true);
INSERT INTO piggyvest_primary.goal_provisioning_authorities(integration_id, executor_login, enabled)
  VALUES ('00000000-0000-4000-8000-000000000004', session_user, true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES ('a3200000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004',
    'a3200000-0000-4000-8000-000000000002', 'a3200000-0000-4000-8000-000000000003',
    'a3200000-0000-4000-8000-000000000001', repeat('b', 64), 'verified',
    'pv-customer', 'pv-primary-wallet');

-- 1. A new goal wallet gets the pinned 42-character name, and stores it.
DO $$
DECLARE v_claim jsonb := pg_temp.prepare(pg_temp.goal(6));
BEGIN
  PERFORM pg_temp.check(v_claim->>'status' = 'claimed', 'goal wallet not claimed');
  PERFORM pg_temp.check(v_claim->>'walletName' = 'baci-save-d80a9fbb7f8c666ce4462294b4e53d25',
    'prepare_goal_wallet diverged from buildPrimaryGoalWalletName: ' || (v_claim->>'walletName'));
  PERFORM pg_temp.check(length(v_claim->>'walletName') <= 50, 'goal wallet name exceeds 50 characters');
  PERFORM pg_temp.check(pg_temp.stored(pg_temp.goal(6)) = v_claim->>'walletName',
    'the intent must store the name it returned');
END $$;

-- 2. Every goal gets its own name, all within the limit.
DO $$
DECLARE v_seven text; v_eight text;
BEGIN
  v_seven := pg_temp.prepare(pg_temp.goal(7))->>'walletName';
  v_eight := pg_temp.prepare(pg_temp.goal(8))->>'walletName';
  PERFORM pg_temp.check(v_seven ~ '^baci-save-[0-9a-f]{32}$' AND v_eight ~ '^baci-save-[0-9a-f]{32}$',
    'goal wallet names must be baci-save- plus 32 hex characters');
  PERFORM pg_temp.check(v_seven <> v_eight AND v_seven <> pg_temp.stored(pg_temp.goal(6)),
    'goal wallet names must differ per goal');
  PERFORM pg_temp.check(
    (SELECT max(length(wallet_name)) FROM piggyvest_primary.goal_wallet_intents
     WHERE integration_id = '00000000-0000-4000-8000-000000000004') <= 50,
    'a stored goal wallet name exceeds 50 characters');
END $$;

-- 3. A stale intent re-claimed after its lease keeps the stored name.
DO $$
DECLARE v_goal uuid := pg_temp.goal(6); v_claim jsonb;
BEGIN
  PERFORM pg_temp.check(
    piggyvest_primary.record_goal_wallet(pg_temp.scope(), v_goal,
      (SELECT claim_token FROM piggyvest_primary.goal_wallet_intents
       WHERE integration_id = '00000000-0000-4000-8000-000000000004' AND goal_id = v_goal), NULL),
    'unknown outcome not recorded');
  UPDATE piggyvest_primary.goal_wallet_intents SET updated_at = now() - interval '6 minutes'
    WHERE integration_id = '00000000-0000-4000-8000-000000000004' AND goal_id = v_goal;
  v_claim := pg_temp.prepare(v_goal);
  PERFORM pg_temp.check(v_claim->>'status' = 'claimed', 'a stale unknown intent must be re-claimed');
  PERFORM pg_temp.check(v_claim->>'walletName' = 'baci-save-d80a9fbb7f8c666ce4462294b4e53d25',
    'a re-claimed intent must keep its stored name');
END $$;

-- 4. The immutability trigger is back on, and grants are unchanged.
DO $$
DECLARE
  v_fn regprocedure := 'piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)'::regprocedure;
  v_role text;
BEGIN
  PERFORM pg_temp.check(
    (SELECT tgenabled = 'O' FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'piggyvest_primary.goal_wallet_intents'::regclass
       AND tgname = 'primary_goal_wallet_choice_immutable'),
    'the goal wallet name immutability trigger must be enabled');
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
      v_role || ' can execute prepare_goal_wallet');
  END LOOP;
  PERFORM pg_temp.check(
    pg_catalog.has_function_privilege('piggyvest_primary_goal_provisioner', v_fn, 'EXECUTE'),
    'the goal provisioner lost EXECUTE on prepare_goal_wallet');
  PERFORM pg_temp.check(
    (SELECT coalesce(array_agg(acl.grantee::regrole::text ORDER BY acl.grantee::regrole::text), '{}')
       = ARRAY['piggyvest_primary_goal_provisioner']
     FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) acl
     WHERE p.oid = v_fn AND acl.grantee <> p.proowner AND acl.privilege_type = 'EXECUTE'
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid = acl.grantee AND r.rolsuper)),
    'only the goal provisioner may hold EXECUTE besides the owner');
  PERFORM pg_temp.check(
    (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
     FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
    'prepare_goal_wallet must stay SECURITY DEFINER with a pinned search_path');
END $$;

ROLLBACK;
