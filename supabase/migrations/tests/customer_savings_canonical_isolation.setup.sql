\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.isolation_assert(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS assertion: %', label;
END $$;
CREATE FUNCTION pg_temp.isolation_reject(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN
      RAISE NOTICE 'PASS rejection: %', expected_state;
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected_state;
END $$;
SELECT pg_temp.isolation_assert(current_database() = 'postgres' AND inet_client_addr() IS NULL,
  'reviewed full-schema local socket database required');
SELECT pg_temp.isolation_assert(EXISTS(SELECT 1 FROM public.customer_savings_drafts
  WHERE id = :'draft' AND merchant_id = :'merchant' AND customer_id = :'customer'
    AND actor_id = :'actor' AND accepted_at IS NOT NULL), 'parent supplied accepted synthetic draft');
SELECT pg_temp.isolation_assert(EXISTS(SELECT 1 FROM public.customer_wallets
  WHERE customer_id = :'customer' AND merchant_id = :'merchant' AND available_balance >= 10), 'funded synthetic legacy wallet exercises rollback');
SELECT pg_temp.isolation_assert(EXISTS(SELECT 1 FROM public.customer_savings_goals
  WHERE id = :'legacy_goal' AND goal_kind = 'legacy' AND customer_id = :'customer'
    AND merchant_id = :'merchant' AND current_amount + 10 < target_amount), 'eligible legacy control');

CREATE FUNCTION pg_temp.insert_canonical(p_goal uuid, p_draft uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, variant_id,
    title, target_amount, status, source_mode, goal_kind, canonical_draft_id, canonical_draft_revision_id, canonical_actor_id)
    SELECT p_goal, draft.merchant_id, draft.customer_id, draft.product_id, draft.variant_id,
      draft.catalogue->>'name', COALESCE((draft.catalogue#>>'{variants,0,price_override}')::numeric,
        (draft.catalogue->>'price')::numeric), 'paused', 'manual', 'canonical_local', draft.id, draft.revision_id, draft.actor_id
    FROM public.customer_savings_drafts draft WHERE draft.id = p_draft;
END $$;

SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'canonical_goal', :'draft'), '42501');
INSERT INTO savings_draft_private.canonical_creation_scopes(merchant_id) VALUES(:'merchant');
SELECT pg_temp.isolation_assert((SELECT enabled IS FALSE FROM savings_draft_private.canonical_creation_scopes WHERE merchant_id = :'merchant'), 'creation defaults disabled');
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'canonical_goal', :'draft'), '42501');
RESET SESSION AUTHORIZATION;
UPDATE savings_draft_private.canonical_creation_scopes SET enabled = true WHERE merchant_id = :'merchant';
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.insert_canonical(:'canonical_goal', :'draft');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.isolation_assert(EXISTS(SELECT 1 FROM public.customer_savings_goals
  WHERE id = :'canonical_goal' AND contribution_amount IS NULL AND contribution_frequency IS NULL
    AND start_date IS NULL AND maturity_date IS NULL AND terms_accepted_at IS NULL
    AND non_withdrawable_accepted_at IS NULL AND auto_debit_authorized_at IS NULL
    AND current_amount = 0 AND initial_contribution_amount = 0), 'unknown consents and schedule remain null');
