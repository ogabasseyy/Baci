CREATE SCHEMA auth;
CREATE SCHEMA prefunded_card;
CREATE SCHEMA piggyvest_staging;
CREATE SCHEMA piggyvest_savings_ledger;
CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT VALID UNTIL '2026-10-06T15:59:10Z';
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid,deleted_at timestamptz);
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,
  current_amount numeric,initial_contribution_amount numeric,goal_kind text,source_mode text,status text,
  completed_at timestamptz,cancelled_at timestamptz,spent_at timestamptz,metadata jsonb);
CREATE TABLE public.customer_savings_contributions(id uuid PRIMARY KEY,goal_id uuid,amount numeric);
CREATE TABLE public.piggyvest_inflow_credits(wallet_id text);
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,enabled boolean,expected_provider_account_id text);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(goal_id uuid PRIMARY KEY,integration_id uuid,
  merchant_id uuid,customer_id uuid,provider_wallet_id text,provider_customer_id text);
CREATE TABLE piggyvest_staging.goal_inflow_projections(goal_id uuid);
CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid PRIMARY KEY,integration_id uuid,
  merchant_id uuid,customer_id uuid,enabled boolean,authorized_login text);
CREATE TABLE piggyvest_savings_ledger.operations(goal_id uuid);
CREATE TABLE piggyvest_savings_ledger.postings(operation_id uuid,amount_kobo bigint);
CREATE TABLE piggyvest_savings_ledger.interest_policies(goal_id uuid);
CREATE TABLE prefunded_card.operations(goal_id uuid);
CREATE TABLE prefunded_card.bank_projections(goal_id uuid);
CREATE TABLE prefunded_card.checkout_intents(goal_id uuid);
CREATE TABLE prefunded_card.provider_evidence(observation jsonb);
CREATE TABLE prefunded_card.evidence_authorities(integration_id uuid,business_id text,system_identifier text,
  ingestion_login text,reader_login text,currency text,enabled boolean);
CREATE TABLE prefunded_card.credit_routes(goal_id uuid PRIMARY KEY,integration_id uuid,
  merchant_id uuid,customer_id uuid,system_identifier text);
CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,integration_id uuid,merchant_id uuid,
  expected_business_id text,source_wallet_id text,currency text,authorized_login text,enabled boolean,
  verified_available_kobo bigint,reserved_kobo bigint,consumed_kobo bigint);
CREATE TABLE prefunded_card.treasury_identities(treasury_binding_id uuid PRIMARY KEY,integration_id uuid,
  merchant_id uuid,expected_business_id text,source_wallet_id text,authorized_login text,opening_available_kobo bigint);
CREATE TABLE prefunded_card.treasury_replenishments(amount_kobo bigint);
INSERT INTO auth.users VALUES ('baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',null);
INSERT INTO public.customers VALUES ('10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001','baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',null);
INSERT INTO public.customer_savings_goals VALUES
  ('9f01153c-1589-4dde-b9aa-8f644a846832','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',0,0,'legacy','manual','active',null,null,null,
   '{"stagingTestPlanKey":"pvb-empty-interest-staging-20261002-v1","interestOptIn":true,"prefundingKobo":0}'),
  ('430314fd-cd8b-4579-98d4-e9f345713dd6','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',100,100,'legacy','manual','active',null,null,null,'{}');
INSERT INTO piggyvest_staging.integrations VALUES ('d91d9e87-8e0d-44de-9b84-1e1d709633d2',true,'01M2381RG34HQJMHQKE7DWDACR');
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
  ('9f01153c-1589-4dde-b9aa-8f644a846832','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
   '01M3W0Y93XHJY9RPQ2G75X81WG','c096507d-dc32-45d2-9c01-871a27abfd10');
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
  ('430314fd-cd8b-4579-98d4-e9f345713dd6','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
   '01M3CQX27G9687EFSF1TKYMPR9','c096507d-dc32-45d2-9c01-871a27abfd10');
INSERT INTO prefunded_card.evidence_authorities VALUES
  ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','01M2381RG34HQJMHQKE7DWDACR','7685292944002592802',
   'prefunded_evidence','prefunded_treasury_operator','NGN',true);
INSERT INTO piggyvest_savings_ledger.bindings VALUES
  ('9f01153c-1589-4dde-b9aa-8f644a846832','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',true,'prefunded_treasury_operator');
INSERT INTO prefunded_card.treasury_bindings VALUES
  ('ffffcb16-2e95-5cff-a591-e9cc81cf5f57','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','01M2381RG34HQJMHQKE7DWDACR','01M238A0V75387H4HZ15YFWGX3',
   'NGN','prefunded_treasury_operator',true,10000,0,0);
INSERT INTO prefunded_card.treasury_identities SELECT id,integration_id,merchant_id,expected_business_id,
  source_wallet_id,authorized_login,10000 FROM prefunded_card.treasury_bindings;
