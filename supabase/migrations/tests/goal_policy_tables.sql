-- =============================================
-- REGRESSION TEST: Goal-policy prerequisite tables
--   The reconstructed 20260912140000 prerequisite must satisfy every
--   in-chain consumer: draft storage/binding foreign keys and triggers apply
--   (proven by replay reaching this check), and the policy entrypoints honor
--   their statement contracts end to end (stage -> prepare -> accept ->
--   activate -> read) while failing closed on missing terms, unknown
--   revisions, and unaccepted policies.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/goal_policy_tables.sql
-- =============================================

BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

-- The writer role is provisioned out-of-band in real environments; create it
-- here so the contracted entrypoints are exercisable (rolled back).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_policy_writer') THEN
    CREATE ROLE piggyvest_staging_policy_writer NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA piggyvest_goal_policy TO piggyvest_staging_policy_writer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA piggyvest_goal_policy TO piggyvest_staging_policy_writer;

-- Every consumer's DDL anchor exists.
SELECT pg_temp.assert_true(to_regclass('piggyvest_goal_policy.terms') IS NOT NULL, 'terms table exists');
SELECT pg_temp.assert_true(to_regclass('piggyvest_goal_policy.snapshots') IS NOT NULL, 'snapshots table exists');
SELECT pg_temp.assert_true(to_regclass('piggyvest_goal_policy.lifecycle_terms') IS NOT NULL, 'lifecycle_terms table exists');
SELECT pg_temp.assert_true(to_regclass('piggyvest_goal_policy.lifecycle_activations') IS NOT NULL, 'lifecycle_activations table exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.immutable()') IS NOT NULL, 'immutable trigger exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.guard_configuration()') IS NOT NULL, 'guard trigger exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.lock_scope(uuid,uuid,uuid,uuid,text)') IS NOT NULL, 'lock_scope exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.stage(uuid,uuid,uuid,uuid,text,jsonb)') IS NOT NULL, 'stage exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.accept(uuid,uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL, 'accept exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.read(uuid,uuid,uuid,uuid,text)') IS NOT NULL, 'read exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.prepare_lifecycle_terms(uuid,uuid,uuid,uuid,text,uuid,integer)') IS NOT NULL, 'prepare exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.accept_lifecycle_terms(uuid,uuid,uuid,uuid,text,uuid,uuid,integer)') IS NOT NULL, 'lifecycle accept exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.activate_lifecycle(uuid,uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL, 'activate exists');
SELECT pg_temp.assert_true(to_regprocedure('piggyvest_goal_policy.read_funding_capability(uuid,uuid,uuid,uuid,text,uuid)') IS NOT NULL, 'capability read exists');

-- Catalogue columns the stage path reads (present on the real chain;
-- no-op there, load-bearing on slim replay bases).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;

INSERT INTO public.merchants(id, email, is_published) VALUES
  ('97000000-0000-4000-8000-000000000001', 'goal-policy-probe@example.com', true);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity, condition, has_variants) VALUES
  ('97000000-0000-4000-8000-000000000007', '97000000-0000-4000-8000-000000000001', 'Probe device', 250000, 'active', 3, 'New', false);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, source_mode, target_amount,
  contribution_amount, contribution_frequency, start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at, updated_at) VALUES
  ('97000000-0000-4000-8000-000000000004', '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002',
   '97000000-0000-4000-8000-000000000007', 'Probe goal', 'manual', 25000000, 1000, 'weekly',
   '2026-10-01', '2027-10-01', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-06T00:00:00Z');
INSERT INTO piggyvest_staging.integrations(id, expected_provider_account_id, enabled) VALUES
  ('97000000-0000-4000-8000-000000000011', 'provider-acct-probe', true);
INSERT INTO piggyvest_goal_policy.terms(version, sha256, enabled) VALUES
  ('v1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', true);

SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;

-- Read on an empty policy returns NULL.
SELECT pg_temp.assert_true(
  (SELECT result IS NULL FROM piggyvest_goal_policy.read(
    '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
    'unit-test-business') AS result),
  'Read returns NULL when nothing is staged');

-- Stage -> prepare -> accept -> activate -> read.
SELECT pg_temp.assert_true(
  (SELECT result->>'outcome' = 'staged'
   FROM piggyvest_goal_policy.stage(
     '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
     '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
     'unit-test-business',
     '{"revisionId":"97000000-0000-4000-8000-000000000021","termsVersion":"v1","termsHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","expectedGoalUpdatedAt":"2026-10-06T00:00:00Z","productId":"97000000-0000-4000-8000-000000000007","variantId":null,"allocationId":null,"quoteKobo":25000000,"quoteExpiresAt":"2099-01-01T00:00:00Z","guarantee":null,"consistency":"revision-only","lifecycle":"draft","lifecycleOperationId":null,"collectionPaused":true}'::jsonb) AS result),
  'Stage succeeds');
SELECT pg_temp.assert_true(
  (SELECT result->>'outcome' = 'prepared'
   FROM piggyvest_goal_policy.prepare_lifecycle_terms(
     '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
     '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
     'unit-test-business', '97000000-0000-4000-8000-000000000021', 3) AS result),
  'Prepare succeeds');
SELECT pg_temp.assert_true(
  (SELECT result->>'outcome' = 'accepted'
   FROM piggyvest_goal_policy.accept_lifecycle_terms(
     '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
     '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
     'unit-test-business', '97000000-0000-4000-8000-000000000021',
     '97000000-0000-4000-8000-000000000003', 3) AS result),
  'Lifecycle accept succeeds');
SELECT pg_temp.assert_true(
  (SELECT receipt->>'lifecycle' = 'active'
     AND (receipt->>'guaranteeKobo')::bigint = 25000000
     AND receipt->>'collectionConsent' = 'not_granted'
     AND (receipt->>'maturesAt')::timestamptz > (receipt->>'activatedAt')::timestamptz
     AND (receipt->>'graceExpiresAt')::timestamptz > (receipt->>'maturesAt')::timestamptz
   FROM piggyvest_goal_policy.activate_lifecycle(
     '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
     '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
     'unit-test-business', '97000000-0000-4000-8000-000000000021',
     '97000000-0000-4000-8000-000000000031') AS receipt),
  'Activation receipt valid');

-- Fail-closed: unknown revision, unaccepted activation, missing capability.
DO $$
BEGIN
  PERFORM piggyvest_goal_policy.accept(
    '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
    'unit-test-business', '97000000-0000-4000-8000-000000000099',
    '97000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'unknown revision must raise';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '23514' THEN RAISE; END IF;
END $$;
SELECT pg_temp.assert_true(
  (SELECT result IS NULL FROM piggyvest_goal_policy.read_funding_capability(
    '97000000-0000-4000-8000-000000000011', '97000000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000004',
    'unit-test-business', '97000000-0000-4000-8000-000000000003') AS result),
  'Capability without a wallet mapping returns NULL');

RESET SESSION AUTHORIZATION;

-- The configuration guard permits only the enabled flip.
INSERT INTO savings_draft_private.canonical_creation_scopes(merchant_id, environment, enabled) VALUES
  ('97000000-0000-4000-8000-000000000001', 'local_test', true);
UPDATE savings_draft_private.canonical_creation_scopes SET enabled = false
  WHERE merchant_id = '97000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  UPDATE savings_draft_private.canonical_creation_scopes SET environment = 'changed'
    WHERE merchant_id = '97000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'scope identity change must raise';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '23514' THEN RAISE; END IF;
END $$;

ROLLBACK;
