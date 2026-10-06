CREATE FUNCTION pg_temp.isolation_hidden_update(command text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected bigint;
BEGIN
  BEGIN
    EXECUTE command;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Hidden row mutated'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
END $$;
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET goal_kind=%L WHERE id=%L', 'canonical_local', :'legacy_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET goal_kind=%L WHERE id=%L', 'legacy', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET current_amount=1 WHERE id=%L', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET initial_contribution_amount=1 WHERE id=%L', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET terms_accepted_at=clock_timestamp() WHERE id=%L', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET maturity_date=current_date WHERE id=%L', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('DELETE FROM public.customer_savings_goals WHERE id=%L', :'canonical_goal'), '23514');

CREATE FUNCTION pg_temp.reject_contribution_matrix(p_goal uuid, p_merchant uuid, p_customer uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE source text; state text;
BEGIN
  FOREACH source IN ARRAY ARRAY['wallet', 'paystack_authorization', 'manual_adjustment'] LOOP
    FOREACH state IN ARRAY ARRAY['pending', 'processing', 'completed', 'failed', 'cancelled'] LOOP
      PERFORM pg_temp.isolation_reject(format(
        'INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,source_type,status,idempotency_key) VALUES(%L,%L,%L,1,%L,%L,%L)',
        p_goal, p_merchant, p_customer, source, state, 'canonical-isolation-' || source || '-' || state), '23514');
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.reject_contribution_matrix(:'canonical_goal', :'merchant', :'customer');
INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,source_type,status,idempotency_key)
  VALUES(:'legacy_goal', :'merchant', :'customer', 1, 'manual_adjustment', 'pending', 'canonical-isolation-retarget')
  RETURNING id AS retarget_contribution \gset
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_contributions SET goal_id=%L WHERE id=%L', :'canonical_goal', :'retarget_contribution'), '23514');
SELECT pg_temp.isolation_reject(format('INSERT INTO public.customer_savings_redemptions(goal_id,merchant_id,customer_id,order_id,amount,idempotency_key) VALUES(%L,%L,%L,%L,1,%L)',
  :'canonical_goal', :'merchant', :'customer', :'order', 'canonical-isolation-redeem'), '23514');
SELECT pg_temp.isolation_reject(format('INSERT INTO public.customer_savings_events(goal_id,merchant_id,customer_id,event_type) VALUES(%L,%L,%L,%L)',
  :'canonical_goal', :'merchant', :'customer', 'auto_debit_scheduled'), '23514');
SELECT pg_temp.isolation_reject(format('INSERT INTO piggyvest_savings_ledger.operations(id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id) VALUES(gen_random_uuid(),%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'canonical_goal', '{"kind":"credit_principal","principalKobo":100}', 'canonical-isolation-ledger'), '23514');

SET LOCAL ROLE service_role;
SELECT pg_temp.reject_contribution_matrix(:'canonical_goal', :'merchant', :'customer');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET current_amount=1 WHERE id=%L', :'canonical_goal'), '23514');
SELECT pg_temp.isolation_reject(format('UPDATE public.customer_savings_contributions SET goal_id=%L WHERE id=%L', :'canonical_goal', :'retarget_contribution'), '23514');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.isolation_hidden_update(format('UPDATE public.customer_savings_goals SET goal_kind=%L WHERE id=%L', 'legacy', :'canonical_goal'));
SELECT pg_temp.isolation_reject(format('INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,source_type,status,idempotency_key) VALUES(%L,%L,%L,1,%L,%L,%L)',
  :'canonical_goal', :'merchant', :'customer', 'wallet', 'completed', 'canonical-isolation-rls-insert'), '42501');
SELECT pg_temp.isolation_reject('UPDATE savings_draft_private.canonical_creation_scopes SET enabled = true', '42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.isolation_reject(format('SELECT id FROM public.customer_savings_goals WHERE id=%L', :'canonical_goal'), '42501');
SELECT pg_temp.isolation_reject('SELECT merchant_id FROM savings_draft_private.canonical_creation_scopes', '42501');
RESET ROLE;

CREATE FUNCTION pg_temp.reject_legacy_nulls(p_goal uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  FOREACH field IN ARRAY ARRAY['contribution_amount','contribution_frequency','start_date','maturity_date','terms_accepted_at','non_withdrawable_accepted_at'] LOOP
    PERFORM pg_temp.isolation_reject(format('UPDATE public.customer_savings_goals SET %I=NULL WHERE id=%L', field, p_goal), '23502');
  END LOOP;
END $$;
SELECT pg_temp.reject_legacy_nulls(:'legacy_goal');
