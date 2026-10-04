\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.binding_assert(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION pg_temp.binding_reject(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected_state;
END $$;

SELECT pg_temp.binding_assert(current_database() = 'piggyvest_local' AND inet_client_addr() IS NULL,
  'reviewed socket database required');
SELECT pg_temp.binding_assert(NOT EXISTS (
  SELECT 1 FROM savings_draft_private.canonical_bindings WHERE draft_id = :'draft' OR goal_id = :'goal'
), 'fresh parent-prepared synthetic fixture required');
SELECT to_jsonb(goal)::text AS before_goal FROM public.customer_savings_goals goal WHERE id = :'goal' \gset
SELECT to_jsonb(draft)::text AS before_draft FROM public.customer_savings_drafts draft WHERE id = :'draft' \gset
SELECT count(*) AS before_contributions FROM public.customer_savings_contributions \gset
SELECT count(*) AS before_operations FROM piggyvest_savings_ledger.operations \gset
SELECT count(*) AS before_consents FROM piggyvest_goal_policy.consents \gset
SELECT count(*) AS before_provisioning FROM piggyvest_staging.provisioning_intents \gset
SELECT format('SELECT savings_draft_private.bind_canonical(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'goal', :'business', :'actor', :'draft', :'draft_revision', :'revision') AS command \gset

SELECT pg_temp.binding_reject(:'command', '42501');
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(replace(:'command', :'actor', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), '42501');
SELECT pg_temp.binding_reject(replace(:'command', :'merchant', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), '42501');
SELECT pg_temp.binding_reject(replace(:'command', :'customer', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), '42501');
SELECT pg_temp.binding_reject(replace(:'command', :'draft_revision', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), '23514');
SELECT pg_temp.binding_reject(replace(:'command', :'revision', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), '23514');
SELECT savings_draft_private.bind_canonical(:'integration', :'merchant', :'customer', :'goal', :'business',
  :'actor', :'draft', :'draft_revision', :'revision')::text AS receipt \gset
SELECT pg_temp.binding_assert(savings_draft_private.bind_canonical(:'integration', :'merchant', :'customer', :'goal', :'business',
  :'actor', :'draft', :'draft_revision', :'revision') = :'receipt'::jsonb, 'identical replay receipt');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.binding_assert((SELECT count(*) = 1 FROM savings_draft_private.canonical_bindings WHERE draft_id = :'draft'), 'one binding');
SELECT pg_temp.binding_assert((SELECT to_jsonb(goal) = :'before_goal'::jsonb FROM public.customer_savings_goals goal WHERE id = :'goal'), 'legacy fields unchanged');
SELECT pg_temp.binding_assert((SELECT to_jsonb(draft) = :'before_draft'::jsonb FROM public.customer_savings_drafts draft WHERE id = :'draft'), 'draft acceptance unchanged');
SELECT pg_temp.binding_assert((SELECT count(*) = :before_contributions FROM public.customer_savings_contributions), 'no contribution');
SELECT pg_temp.binding_assert((SELECT count(*) = :before_operations FROM piggyvest_savings_ledger.operations), 'no ledger entry');
SELECT pg_temp.binding_assert((SELECT count(*) = :before_consents FROM piggyvest_goal_policy.consents), 'no promoted consent');
SELECT pg_temp.binding_assert((SELECT count(*) = :before_provisioning FROM piggyvest_staging.provisioning_intents), 'no provisioning');
SELECT pg_temp.binding_reject('UPDATE savings_draft_private.canonical_bindings SET bound_at = clock_timestamp()', '23514');
SELECT pg_temp.binding_reject('DELETE FROM savings_draft_private.canonical_bindings', '23514');
SELECT pg_temp.binding_reject('TRUNCATE savings_draft_private.canonical_bindings', '23514');

SAVEPOINT stale_catalogue;
UPDATE public.products SET name = name || ' changed' WHERE id = (:'before_draft'::jsonb->>'product_id')::uuid;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT stale_catalogue;
SAVEPOINT stale_price;
UPDATE public.products SET price = price + 1 WHERE id = (:'before_draft'::jsonb->>'product_id')::uuid;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT stale_price;
SAVEPOINT disabled_terms;
UPDATE piggyvest_goal_policy.terms SET enabled = false WHERE version = :'before_draft'::jsonb->>'terms_version';
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '42501');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT disabled_terms;
SAVEPOINT disabled_settings;
UPDATE savings_draft_private.settings SET enabled = false WHERE merchant_id = :'merchant';
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '42501');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT disabled_settings;

SAVEPOINT stale_goal;
UPDATE public.customer_savings_goals SET updated_at = updated_at + interval '1 second' WHERE id = :'goal';
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT stale_goal;
SAVEPOINT funded_goal;
UPDATE public.customer_savings_goals SET current_amount = 1 WHERE id = :'goal';
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(:'command', '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT funded_goal;
SAVEPOINT unaccepted_draft;
INSERT INTO public.customer_savings_drafts(merchant_id, customer_id, actor_id, request_id,
  product_id, variant_id, catalogue, terms_version, terms_hash)
  SELECT merchant_id, customer_id, actor_id, gen_random_uuid(), product_id, variant_id, catalogue,
    terms_version, terms_hash FROM public.customer_savings_drafts WHERE id = :'draft'
  RETURNING id AS unaccepted_id, revision_id AS unaccepted_revision \gset
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.binding_reject(replace(replace(:'command', :'draft', :'unaccepted_id'), :'draft_revision', :'unaccepted_revision'), '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT unaccepted_draft;
SAVEPOINT canonical_consent;
SELECT max(duration_months) AS months FROM piggyvest_goal_policy.lifecycle_terms WHERE goal_id = :'goal' \gset
\if :{?months}
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT piggyvest_goal_policy.accept_lifecycle_terms(:'integration', :'merchant', :'customer', :'goal', :'business', :'revision', :'actor', :months);
\else
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT piggyvest_goal_policy.accept(:'integration', :'merchant', :'customer', :'goal', :'business', :'revision', :'actor');
\endif
SELECT pg_temp.binding_reject(:'command', '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT canonical_consent;

SET LOCAL ROLE authenticated;
SELECT pg_temp.binding_reject(:'command', '42501');
SELECT pg_temp.binding_reject('SELECT draft_id FROM savings_draft_private.canonical_bindings', '42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.binding_reject(:'command', '42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.binding_reject(:'command', '42501');
RESET ROLE;
ROLLBACK;
\echo 'PASS binding replay, ownership, stale catalogue/terms, immutable receipt and zero side effects'
