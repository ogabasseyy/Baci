-- Contract test: piggyvest_primary.enroll_goal_wallet matches the
-- provider-listed wallet name the way matchesProviderWalletName does
-- (apps/web/src/lib/piggyvest/provider-wallet-name.ts).
--
-- PiggyVest rewrites the names of the sub-wallets it creates (every "-"
-- removed), so the name it lists back is not the stored
-- 'baci-save-<hash>' (20261031220000). Proves, against live PostgreSQL:
--   * a listed name with dashes stripped, or only its case changed, enrols;
--   * a genuinely different name is refused, and every other check (provider
--     customer, primary wallet, a wallet used by another goal, the interest
--     choice) still refuses a matching name;
--   * goal intents of one integration that normalise to the same name fail
--     closed: nothing is enrolled for either, even for an exact match;
--   * a stored name with no letters or digits matches nothing;
--   * an exact stored name keeps working, and replays stay idempotent;
--   * grants are unchanged, asserted through the catalog (a denied EXECUTE
--     cannot be trapped on the replay image, so no denial is ever probed by
--     calling the function).
-- The calls run as the session role, registered as the goal executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_enroll_goal_wallet_name.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.goal(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('a3100000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.scope() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3100000-0000-4000-8000-000000000002',
    'customerId', 'a3100000-0000-4000-8000-000000000003',
    'userId', 'a3100000-0000-4000-8000-000000000001',
    'integrationId', 'a3100000-0000-4000-8000-000000000005',
    'businessId', 'enroll-name-business',
    'environment', 'staging')
$$;

-- The name the application stores and sends to the provider (20261031220000).
CREATE FUNCTION pg_temp.stored_name(p_goal uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'baci-save-' || substr(encode(sha256(convert_to('a3100000-0000-4000-8000-000000000005:' || p_goal::text, 'UTF8')), 'hex'), 1, 32)
$$;

CREATE FUNCTION pg_temp.proof(
  p_name text, p_wallet text,
  p_customer text DEFAULT 'pv-customer', p_interest boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'providerCustomerId', p_customer, 'providerWalletId', p_wallet,
    'walletName', p_name, 'businessId', 'enroll-name-business',
    'currency', 'NGN', 'status', 'active', 'type', 'api',
    'hasFundingAccount', true, 'interestAccepted', p_interest)
$$;

-- Claims through the real RPC; the outcome is recorded unknown (a timed-out
-- create, the recovery path) or with a wallet id.
CREATE FUNCTION pg_temp.claim(p_goal uuid, p_wallet text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.prepare_goal_wallet(pg_temp.scope(), p_goal, false);
  PERFORM pg_temp.check(v_claim->>'status' = 'claimed', 'goal wallet not claimed');
  PERFORM pg_temp.check(v_claim->>'walletName' = pg_temp.stored_name(p_goal), 'unexpected stored wallet name');
  PERFORM pg_temp.check(
    piggyvest_primary.record_goal_wallet(pg_temp.scope(), p_goal, (v_claim->>'claimToken')::uuid, p_wallet),
    'claim outcome not recorded');
END $$;

CREATE FUNCTION pg_temp.enroll(p_goal uuid, p_proof jsonb) RETURNS boolean
LANGUAGE sql AS $$
  SELECT piggyvest_primary.enroll_goal_wallet(pg_temp.scope(), p_goal, p_proof)
$$;

CREATE FUNCTION pg_temp.state(p_goal uuid) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM piggyvest_primary.goal_wallet_intents
  WHERE integration_id = 'a3100000-0000-4000-8000-000000000005' AND goal_id = p_goal
$$;

CREATE FUNCTION pg_temp.destinations(p_goal uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM piggyvest_primary.savings_destinations
  WHERE integration_id = 'a3100000-0000-4000-8000-000000000005' AND goal_id = p_goal
$$;

-- Fixture: a verified primary wallet and nine active goals for one customer.
-- The merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('a3100000-0000-4000-8000-000000000001');
INSERT INTO public.merchants(id, email)
  VALUES ('a3100000-0000-4000-8000-000000000002', 'enroll-name@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a3100000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000002',
   'a3100000-0000-4000-8000-000000000001');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity) VALUES
  ('a3100000-0000-4000-8000-000000000004', 'a3100000-0000-4000-8000-000000000002',
   'Enroll name device', 100000, 'active', 3);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.goal(n), 'a3100000-0000-4000-8000-000000000002',
  'a3100000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000004',
  'Enroll name goal ' || n, 'active', 'manual', 100000, 0, 20000, 'daily',
  current_date, current_date + 30, now(), now()
FROM generate_series(101, 109) AS n;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3100000-0000-4000-8000-000000000005', 'a3100000-0000-4000-8000-000000000002',
    'enroll-name-business', 'staging', 'enroll_name_fixture_executor', true);
INSERT INTO piggyvest_primary.goal_provisioning_authorities(integration_id, executor_login, enabled)
  VALUES ('a3100000-0000-4000-8000-000000000005', session_user, true);
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES ('a3100000-0000-4000-8000-000000000006', 'a3100000-0000-4000-8000-000000000005',
    'a3100000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000003',
    'a3100000-0000-4000-8000-000000000001', repeat('a', 64), 'verified',
    'pv-customer', 'pv-primary-wallet');

-- 1. A listed name with every dash removed enrols the destination.
DO $$
DECLARE v_goal uuid := pg_temp.goal(101);
BEGIN
  PERFORM pg_temp.claim(v_goal);
  PERFORM pg_temp.check(
    pg_temp.enroll(v_goal, pg_temp.proof(replace(pg_temp.stored_name(v_goal), '-', ''), 'pv-wallet-101')),
    'a dash-stripped provider name must enrol');
  PERFORM pg_temp.check(pg_temp.state(v_goal) = 'enrolled', 'dash-stripped enrolment must mark the intent enrolled');
  PERFORM pg_temp.check(
    (SELECT count(*) FROM piggyvest_primary.savings_destinations
     WHERE integration_id = 'a3100000-0000-4000-8000-000000000005' AND goal_id = v_goal
       AND provider_wallet_id = 'pv-wallet-101' AND enabled) = 1,
    'dash-stripped enrolment must store exactly one enabled destination');
END $$;

-- 2. A case-only difference, and a case change on top of stripped
--    punctuation, are accepted.
DO $$
DECLARE v_goal uuid := pg_temp.goal(102);
BEGIN
  PERFORM pg_temp.claim(v_goal);
  PERFORM pg_temp.check(
    pg_temp.enroll(v_goal, pg_temp.proof(upper(pg_temp.stored_name(v_goal)), 'pv-wallet-102')),
    'a case-only difference must enrol');
  PERFORM pg_temp.check(pg_temp.destinations(v_goal) = 1, 'case-only enrolment must store one destination');
  v_goal := pg_temp.goal(103);
  PERFORM pg_temp.claim(v_goal);
  PERFORM pg_temp.check(
    pg_temp.enroll(v_goal, pg_temp.proof(
      upper(regexp_replace(pg_temp.stored_name(v_goal), '[^a-zA-Z0-9]', '', 'g')), 'pv-wallet-103')),
    'an upper-cased alphanumeric-only name must enrol');
END $$;

-- 3. A genuinely different name is refused, and every other check still
--    refuses even when the name matches. A final correct call succeeds, so
--    the earlier refusals were not an unrelated failure.
DO $$
DECLARE
  v_goal uuid := pg_temp.goal(104);
  v_name text := pg_temp.stored_name(pg_temp.goal(104));
  v_bad text;
BEGIN
  PERFORM pg_temp.claim(v_goal);
  FOREACH v_bad IN ARRAY ARRAY[
    pg_temp.stored_name(pg_temp.goal(101)),
    v_name || '-copy',
    overlay(v_name PLACING 'f' FROM 20 FOR 1),
    'baci-save',
    '---',
    'x'
  ] LOOP
    PERFORM pg_temp.check(NOT pg_temp.enroll(v_goal, pg_temp.proof(v_bad, 'pv-wallet-104')),
      'a different name was enrolled: ' || v_bad);
  END LOOP;
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-104', 'pv-foreign-customer')),
    'a matching name must not enrol another provider customer');
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-primary-wallet')),
    'a matching name must not enrol the primary wallet');
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-101')),
    'a matching name must not enrol a wallet already used by another goal');
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-104', 'pv-customer', true)),
    'a matching name must not change the interest choice');
  PERFORM pg_temp.check(pg_temp.state(v_goal) = 'unknown' AND pg_temp.destinations(v_goal) = 0,
    'refused calls must leave the intent untouched and store no destination');
  PERFORM pg_temp.check(
    pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-104')),
    'the correct dash-stripped proof must enrol after the refusals');
END $$;

-- 4. Two goal intents of one integration that normalise to the same name:
--    nothing is enrolled for either, even for an exact match. The colliding
--    row is inserted directly because the RPCs only create canonical names.
DO $$
DECLARE
  v_goal uuid := pg_temp.goal(105);
  v_twin uuid := pg_temp.goal(106);
  v_name text := pg_temp.stored_name(pg_temp.goal(105));
BEGIN
  PERFORM pg_temp.claim(v_goal);
  INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id, goal_id, primary_intent_id,
    wallet_name, state, claim_token, interest_accepted)
  VALUES ('a3100000-0000-4000-8000-000000000005', v_twin, 'a3100000-0000-4000-8000-000000000006',
    upper(replace(v_name, '-', '_')), 'dispatched', pg_catalog.gen_random_uuid(), false);
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-105')),
    'an ambiguous dash-stripped name must not enrol');
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_goal, pg_temp.proof(v_name, 'pv-wallet-105')),
    'an ambiguous exact name must not enrol (fail closed, never pick one)');
  PERFORM pg_temp.check(
    NOT pg_temp.enroll(v_twin, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-106')),
    'the colliding twin must not enrol either');
  PERFORM pg_temp.check(pg_temp.destinations(v_goal) = 0 AND pg_temp.destinations(v_twin) = 0,
    'an ambiguous name must store no destination for either goal');
  PERFORM pg_temp.check(pg_temp.state(v_goal) = 'unknown' AND pg_temp.state(v_twin) = 'dispatched',
    'an ambiguous name must leave both intents untouched');
  DELETE FROM piggyvest_primary.goal_wallet_intents
    WHERE integration_id = 'a3100000-0000-4000-8000-000000000005' AND goal_id = v_twin;
  PERFORM pg_temp.check(
    pg_temp.enroll(v_goal, pg_temp.proof(replace(v_name, '-', ''), 'pv-wallet-105')),
    'the same proof must enrol once the collision is gone');
END $$;

-- 4b. A stored name with no letters or digits matches nothing, not even
--     itself. Crafted directly: the RPCs only create canonical names.
DO $$
DECLARE v_goal uuid := pg_temp.goal(109);
BEGIN
  INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id, goal_id, primary_intent_id,
    wallet_name, state, interest_accepted)
  VALUES ('a3100000-0000-4000-8000-000000000005', v_goal, 'a3100000-0000-4000-8000-000000000006',
    '---', 'unknown', false);
  PERFORM pg_temp.check(NOT pg_temp.enroll(v_goal, pg_temp.proof('---', 'pv-wallet-109')),
    'a name with no letters or digits must match nothing');
  PERFORM pg_temp.check(NOT pg_temp.enroll(v_goal, pg_temp.proof('+++', 'pv-wallet-109')),
    'two names with no letters or digits must not match each other');
  PERFORM pg_temp.check(pg_temp.destinations(v_goal) = 0, 'an empty name must store no destination');
END $$;

-- 5. Exact matches keep working: an accepted wallet enrols and replays, and
--    is never replaced; an unknown-outcome intent enrols on its exact name.
DO $$
DECLARE
  v_goal uuid := pg_temp.goal(107);
  v_name text := pg_temp.stored_name(pg_temp.goal(107));
BEGIN
  PERFORM pg_temp.claim(v_goal, 'pv-wallet-107');
  PERFORM pg_temp.check(pg_temp.state(v_goal) = 'accepted', 'recorded wallet must be accepted');
  PERFORM pg_temp.check(NOT pg_temp.enroll(v_goal, pg_temp.proof(v_name, 'pv-wallet-changed')),
    'an accepted wallet must not be replaced');
  PERFORM pg_temp.check(pg_temp.enroll(v_goal, pg_temp.proof(v_name, 'pv-wallet-107')),
    'an exact stored name must still enrol');
  PERFORM pg_temp.check(pg_temp.enroll(v_goal, pg_temp.proof(v_name, 'pv-wallet-107')),
    'an exact enrolment must replay');
  PERFORM pg_temp.check(pg_temp.destinations(v_goal) = 1 AND pg_temp.state(v_goal) = 'enrolled',
    'replays must keep exactly one enrolled destination');
  v_goal := pg_temp.goal(108);
  PERFORM pg_temp.claim(v_goal);
  PERFORM pg_temp.check(pg_temp.enroll(v_goal, pg_temp.proof(pg_temp.stored_name(v_goal), 'pv-wallet-108')),
    'an exact stored name must enrol an unknown-outcome intent');
END $$;

-- 6. Grants and shape, through the catalog only.
DO $$
DECLARE
  v_fn regprocedure := 'piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)'::regprocedure;
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
      v_role || ' can execute enroll_goal_wallet');
  END LOOP;
  PERFORM pg_temp.check(
    pg_catalog.has_function_privilege('piggyvest_primary_goal_provisioner', v_fn, 'EXECUTE'),
    'the goal provisioner lost EXECUTE on enroll_goal_wallet');
  PERFORM pg_temp.check(
    (SELECT proacl IS NOT NULL FROM pg_catalog.pg_proc WHERE oid = v_fn),
    'enroll_goal_wallet must carry an explicit ACL');
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
    'enroll_goal_wallet must stay SECURITY DEFINER with a pinned search_path');
END $$;

ROLLBACK;
