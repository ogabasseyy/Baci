\set merchant '10000000-0000-4000-8000-000000000001'
\set customer '20000000-0000-4000-8000-000000000001'
\set goal '30000000-0000-4000-8000-000000000001'
\set integration '40000000-0000-4000-8000-000000000001'
\set product '50000000-0000-4000-8000-000000000001'
\set variant '60000000-0000-4000-8000-000000000001'
\set revision '70000000-0000-4000-8000-000000000001'
\set operation '80000000-0000-4000-8000-000000000001'
\set actor '90000000-0000-4000-8000-000000000001'
INSERT INTO public.merchants VALUES(:'merchant');
INSERT INTO public.customers VALUES(:'customer',:'merchant',:'actor');
INSERT INTO public.products VALUES(:'product',:'merchant','Synthetic phone',1000,'[]','New','active');
INSERT INTO public.product_variants VALUES(:'variant',:'merchant',:'product',false,'New','[]',NULL,1000,'synthetic-256GB');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,variant_id,title,target_amount,
  contribution_amount,contribution_frequency,start_date,maturity_date,source_mode,status,terms_accepted_at,non_withdrawable_accepted_at)
VALUES(:'goal',:'merchant',:'customer',:'product',:'variant','Synthetic compat',1000,100,'monthly',
  (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date,
  ((clock_timestamp() AT TIME ZONE 'Africa/Lagos')+interval '3 months')::date,
  'manual','paused',clock_timestamp(),clock_timestamp());
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE product_snapshot->>'selectionStatus'='exact') THEN
    RAISE EXCEPTION 'source variant trigger missing'; END IF;
  BEGIN
    UPDATE public.customer_savings_goals SET target_amount='NaN';
    RAISE EXCEPTION 'nonfinite amount accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.customer_savings_goals SET variant_id=NULL;
    RAISE EXCEPTION 'missing variant accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'actor',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.customer_savings_goals)<>1 THEN RAISE EXCEPTION 'own goal hidden'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.customer_savings_goals) THEN RAISE EXCEPTION 'cross actor RLS leak'; END IF;
END $$;
RESET ROLE;
INSERT INTO piggyvest_staging.integrations VALUES(:'integration','synthetic-business',true);
INSERT INTO piggyvest_savings_ledger.bindings VALUES(:'goal',:'integration',:'merchant',:'customer','piggyvest_staging_policy_writer',true);
INSERT INTO piggyvest_goal_policy.bindings VALUES(:'goal',:'integration',:'merchant',:'customer','synthetic-business','piggyvest_staging_policy_writer',true);
INSERT INTO piggyvest_goal_policy.terms VALUES('synthetic-v1',repeat('a',64),true);
INSERT INTO piggyvest_goal_policy.lifecycle_gates VALUES(:'goal',true);
INSERT INTO piggyvest_cancel_plan.reviewed_policies VALUES('synthetic-v1',repeat('a',64),'2026-09-11',true);
SELECT jsonb_build_object('revisionId',:'revision','expectedGoalUpdatedAt',
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'productId',product_id,'variantId',variant_id,'termsVersion','synthetic-v1','termsHash',repeat('a',64),
  'quoteId','synthetic-quote','quoteKobo',100000,'quoteExpiresAt','2099-01-01T00:00:00Z',
  'guarantee',NULL,'lifecycle','draft','collectionPaused',true)::text AS command
FROM public.customer_savings_goals WHERE id=:'goal' \gset
GRANT USAGE ON SCHEMA piggyvest_goal_policy,piggyvest_savings_ledger,piggyvest_cancel_plan TO piggyvest_staging_policy_writer;
GRANT EXECUTE ON FUNCTION piggyvest_goal_policy.stage(uuid,uuid,uuid,uuid,text,jsonb),
  piggyvest_goal_policy.prepare_lifecycle_terms(uuid,uuid,uuid,uuid,text,uuid,integer),
  piggyvest_goal_policy.accept_lifecycle_terms(uuid,uuid,uuid,uuid,text,uuid,uuid,integer),
  piggyvest_goal_policy.activate_lifecycle(uuid,uuid,uuid,uuid,text,uuid,uuid),
  piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb),
  piggyvest_cancel_plan.quote(uuid,uuid,uuid,uuid,text,uuid),
  piggyvest_cancel_plan.prepare(uuid,uuid,uuid,uuid,text,jsonb) TO piggyvest_staging_policy_writer;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT piggyvest_goal_policy.stage(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'command');
SELECT piggyvest_goal_policy.prepare_lifecycle_terms(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'revision',3);
SELECT piggyvest_goal_policy.accept_lifecycle_terms(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'revision',:'actor',3);
SELECT piggyvest_savings_ledger.apply(:'integration',:'merchant',:'customer',:'goal',jsonb_build_object(
  'operationId','80000000-0000-4000-8000-000000000002','kind','credit_principal','principalKobo',5000,
  'interestKobo',0,'evidenceId','synthetic-compat-credit','referenceId',NULL));
SELECT piggyvest_goal_policy.activate_lifecycle(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'revision',:'operation');
SELECT jsonb_build_object('operationId','80000000-0000-4000-8000-000000000003','actorId',:'actor',
  'revisionId',:'revision','termsVersion','synthetic-v1','termsHash',repeat('a',64),'consentVersion','2026-09-11',
  'accepted',true,'principalKobo',5000,'paidInterestKobo',0,'pendingInterestKobo',0)::text AS confirmation \gset
SELECT piggyvest_cancel_plan.prepare(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'confirmation');
SELECT piggyvest_cancel_plan.prepare(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'confirmation');
SELECT piggyvest_cancel_plan.quote(:'integration',:'merchant',:'customer',:'goal','synthetic-business',:'actor');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_cancel_plan.intents)<>1 OR
    (SELECT count(*) FROM piggyvest_goal_policy.lifecycle_activations)<>1 OR
    (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='refund_principal')<>5000 OR
    NOT EXISTS(SELECT 1 FROM public.customer_savings_goals goal JOIN piggyvest_goal_policy.snapshots snapshot ON snapshot.goal_id=goal.id
      WHERE goal.updated_at=snapshot.goal_updated_at AND goal.current_amount=0 AND goal.status='paused') THEN
    RAISE EXCEPTION 'compatibility persistence mismatch'; END IF;
END $$;
\echo 'PASS source variant/finite-money triggers, public actor RLS, duration consent, activation, cancellation replay and snapshot preservation'
