\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
ALTER TABLE public.customer_savings_goals ADD COLUMN completed_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN goal_kind text NOT NULL DEFAULT 'legacy';
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  wallet_transaction_id uuid,amount numeric,source_type text,status text,processed_at timestamptz,
  idempotency_key text UNIQUE,metadata jsonb DEFAULT '{}'
);
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text UNIQUE,enabled boolean);
\ir ../../../../../supabase/migrations/20260912120000_piggyvest_savings_ledger_tables.sql
\ir ../../../../../supabase/migrations/20260912120100_piggyvest_savings_ledger_guards.sql
\ir ../../../../../supabase/migrations/20260912120200_piggyvest_savings_ledger_apply.sql
\ir ../../../../../supabase/migrations/20260912120300_piggyvest_savings_ledger_snapshot.sql
\ir ../../../../../supabase/migrations/20260912120400_piggyvest_savings_ledger_registry_gate.sql
\ir ../../../../../supabase/migrations/20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql
\ir ../../../../../supabase/migrations/20261003160000_piggyvest_ledger_deferred_balance_authority.sql
\ir ../../../../../supabase/migrations/tests/fixtures/legacy-interest-capacity-drafts/20261004200000_customer_savings_paid_interest_completion.sql

CREATE ROLE primary_interest_fixture LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO primary_interest_fixture;
GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) TO primary_interest_fixture;
INSERT INTO piggyvest_staging.integrations VALUES
  ('10000000-0000-4000-8000-000000000001','fixture-business',true),
  ('10000000-0000-4000-8000-000000000002','foreign-business',true);

CREATE FUNCTION pg_temp.assert_true(condition boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.goal_id(number integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('20000000-0000-4000-8000-'||lpad(number::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.command(number integer,kind text,amount bigint,reference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('operationId',pg_temp.goal_id(number),'kind',kind,'principalKobo',0,
    'interestKobo',amount,'evidenceId','primary-interest-fixture:'||number,'referenceId',reference);
$$;
CREATE FUNCTION pg_temp.apply_interest(goal_number integer,command jsonb,integration uuid DEFAULT '10000000-0000-4000-8000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_savings_ledger.apply(integration,'00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',pg_temp.goal_id(goal_number),command);
$$;
CREATE FUNCTION pg_temp.primary_scope() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}'::jsonb;
$$;
CREATE FUNCTION pg_temp.proof(operation_number integer,goal_number integer,amount bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId',pg_temp.goal_id(operation_number),'providerTransactionId','confirmed-'||operation_number,
    'reference','pvb-save-'||pg_temp.goal_id(operation_number),'amountKobo',amount,'sourceWalletId','wallet',
    'destinationWalletId','interest-goal-'||goal_number,'businessId','fixture-business');
$$;

INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
SELECT pg_temp.goal_id(number),'00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','active',130,100 FROM generate_series(11,19) number;
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT intent.integration_id,pg_temp.goal_id(number),intent.id,'interest-goal-'||number,true
FROM piggyvest_primary.onboarding_intents intent CROSS JOIN generate_series(11,18) number WHERE intent.customer_id='00000000-0000-4000-8000-000000000002';
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
SELECT pg_temp.goal_id(number),CASE WHEN number=15 THEN '10000000-0000-4000-8000-000000000002'::uuid
  ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','primary_interest_fixture',true
FROM generate_series(11,19) number;
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,status,target_amount,current_amount)
VALUES(pg_temp.goal_id(20),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',130,130);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
SELECT integration_id,pg_temp.goal_id(20),id,'backfill-principal-goal',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';

\if :{?without_primary_completion}
\else
\ir ../../../../../supabase/migrations/20261007181000_piggyvest_primary_paid_interest_completion.sql
\ir ../../../../../supabase/migrations/20261008090000_piggyvest_primary_savings_reservation_customer.sql
\ir ../../../../../supabase/migrations/20261008090300_piggyvest_primary_savings_reservation_capacity.sql
\endif
\if :{?without_primary_capacity}
ALTER FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) RENAME TO reserve_savings_capacity_wrapper_unused;
ALTER FUNCTION piggyvest_primary.reserve_savings_before_interest(jsonb,jsonb) RENAME TO reserve_savings;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) TO piggyvest_primary_authorizer;
\endif

SELECT pg_temp.assert_true((SELECT prosecdef FROM pg_proc
  WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure),
  'Existing deferred balance authority migration must be installed');
SELECT pg_temp.assert_true(NOT has_table_privilege('primary_interest_fixture',
  'piggyvest_savings_ledger.postings','SELECT'),
  'Restricted interest fixture must not gain direct posting reads');
