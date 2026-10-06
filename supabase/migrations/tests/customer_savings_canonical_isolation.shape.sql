CREATE FUNCTION pg_temp.insert_bad_canonical(p_goal uuid, p_field text, p_value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  EXECUTE format('INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,variant_id,title,target_amount,status,source_mode,goal_kind,canonical_draft_id,canonical_draft_revision_id,canonical_actor_id,%I)
    SELECT gen_random_uuid(),merchant_id,customer_id,product_id,variant_id,title,target_amount,status,source_mode,goal_kind,canonical_draft_id,canonical_draft_revision_id,canonical_actor_id,%L
    FROM public.customer_savings_goals WHERE id=%L', p_field, p_value, p_goal);
END $$;
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'terms_accepted_at', '2026-09-13T00:00:00Z'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'non_withdrawable_accepted_at', '2026-09-13T00:00:00Z'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'auto_debit_authorized_at', '2026-09-13T00:00:00Z'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'contribution_amount', '1'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'contribution_frequency', 'monthly'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'start_date', '2026-09-13'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'maturity_date', '2027-03-13'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'current_amount', '1'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'initial_contribution_amount', '1'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_bad_canonical(%L,%L,%L)', :'canonical_goal', 'metadata', '{"accepted":true}'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'second_canonical_goal', :'draft'), '23505');
RESET SESSION AUTHORIZATION;

SAVEPOINT disabled_scope;
UPDATE savings_draft_private.canonical_creation_scopes SET enabled=false WHERE merchant_id=:'merchant';
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'second_canonical_goal', :'draft'), '42501');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT disabled_scope;
SAVEPOINT changed_catalogue;
UPDATE public.products SET name = name || ' changed' WHERE id=(SELECT product_id FROM public.customer_savings_drafts WHERE id=:'draft');
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'second_canonical_goal', :'draft'), '23514');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT changed_catalogue;

SET LOCAL ROLE savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'second_canonical_goal', :'draft'), '42501');
RESET ROLE;
