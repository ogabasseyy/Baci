CREATE SCHEMA piggyvest_staging;
CREATE SCHEMA piggyvest_savings_ledger;
CREATE SCHEMA prefunded_card;
CREATE SCHEMA savings_notifications;
DO $fixture_roles$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $fixture_roles$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants(id));
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,current_amount numeric);
CREATE TABLE public.customer_savings_contributions(id uuid PRIMARY KEY,goal_id uuid,amount numeric);
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text,enabled boolean);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid,provider_wallet_id text,
  provider_customer_id text,merchant_id uuid,customer_id uuid,goal_id uuid,PRIMARY KEY(integration_id,provider_wallet_id));
CREATE TABLE piggyvest_savings_ledger.operations(id uuid PRIMARY KEY,command jsonb);
CREATE TABLE piggyvest_savings_ledger.postings(operation_id uuid,account text,amount_kobo bigint);
CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,reserved_kobo bigint,consumed_kobo bigint);
CREATE TABLE savings_notifications.events(id uuid PRIMARY KEY,event_key text);
CREATE TABLE savings_notifications.deliveries(id uuid PRIMARY KEY,status text);
INSERT INTO public.merchants VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals VALUES
 ('430314fd-cd8b-4579-98d4-e9f345713dd6','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',100),
 ('9f01153c-1589-4dde-b9aa-8f644a846832','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',100);
INSERT INTO piggyvest_staging.integrations VALUES
 ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','01M2381RG34HQJMHQKE7DWDACR',true);
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
 ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','01M3W0Y93XHJY9RPQ2G75X81WG','c096507d-dc32-45d2-9c01-871a27abfd10',
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','9f01153c-1589-4dde-b9aa-8f644a846832');
INSERT INTO piggyvest_savings_ledger.operations VALUES
 ('ff561046-58e7-428d-9163-f6e60b0dab65','{"kind":"credit_principal","principalKobo":10000,"interestKobo":0}');
INSERT INTO piggyvest_savings_ledger.postings VALUES
 ('ff561046-58e7-428d-9163-f6e60b0dab65','principal',10000),
 ('ff561046-58e7-428d-9163-f6e60b0dab65','internal_clearing',-10000);
INSERT INTO prefunded_card.treasury_bindings VALUES('ffffcb16-2e95-5cff-a591-e9cc81cf5f57',0,10000);
CREATE FUNCTION prefunded_card.executor_system_identity() RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $identity$
 SELECT jsonb_build_object('database',current_database(),'login',session_user,
   'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))
 $identity$;
REVOKE ALL ON FUNCTION prefunded_card.executor_system_identity() FROM PUBLIC;
