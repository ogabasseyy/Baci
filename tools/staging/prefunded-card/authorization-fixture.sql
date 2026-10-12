CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE prefunded_card_authorization_provisioner;
CREATE ROLE prefunded_card_authorization_reader;
CREATE ROLE authorization_provisioner;
CREATE ROLE authorization_worker;
CREATE ROLE authorization_other_worker;
CREATE ROLE authorization_untrusted;
GRANT prefunded_card_authorization_provisioner TO authorization_provisioner;
GRANT prefunded_card_authorization_reader TO authorization_worker, authorization_other_worker;

CREATE TABLE public.merchants(id uuid PRIMARY KEY, slug text NOT NULL);
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid NOT NULL);
CREATE TABLE public.customer_saved_payment_methods(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  provider text NOT NULL, provider_customer_email text NOT NULL,
  authorization_code text NOT NULL, authorization_signature text NOT NULL,
  authorization_data jsonb NOT NULL, reusable boolean NOT NULL,
  is_active boolean NOT NULL, disabled_at timestamptz
);
CREATE TABLE public.transactions(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, transaction_type text NOT NULL,
  amount numeric(15,2) NOT NULL, currency text NOT NULL, status text NOT NULL,
  gateway text, gateway_reference text, gateway_response jsonb, metadata jsonb
);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(
  id uuid PRIMARY KEY, expected_provider_account_id text NOT NULL, enabled boolean NOT NULL
);
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,target_amount numeric NOT NULL,current_amount numeric NOT NULL,
  status text NOT NULL,completed_at timestamptz,cancelled_at timestamptz,spent_at timestamptz);
CREATE TABLE piggyvest_staging.wallet_goal_mappings(integration_id uuid NOT NULL,provider_wallet_id text NOT NULL,
  provider_customer_id text NOT NULL,merchant_id uuid NOT NULL,customer_id uuid NOT NULL,goal_id uuid NOT NULL);
CREATE SCHEMA piggyvest_savings_ledger;
CREATE TABLE piggyvest_savings_ledger.bindings(goal_id uuid PRIMARY KEY,integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,customer_id uuid NOT NULL,authorized_login name NOT NULL,enabled boolean NOT NULL,
  UNIQUE(integration_id,merchant_id,customer_id,goal_id));
\ir storage.sql
\ir storage-functions.sql
CREATE SCHEMA authorization_test;
CREATE FUNCTION authorization_test.id(prefix integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (prefix::text || '0000000-0000-4000-8000-000000000001')::uuid;
$$;
CREATE FUNCTION authorization_test.proof() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id','123456789','status','success','domain','test','channel','card',
    'reference','SAV-AUTH-ORIGINAL','amount',5000,'currency','NGN',
    'customer',jsonb_build_object('email','original@example.test','customer_code','CUS_synthetic'),
    'authorization',jsonb_build_object('authorization_code','AUTH_synthetic','signature','SIG_synthetic','reusable',true,'channel','card'),
    'metadata',jsonb_build_object('customer_id',authorization_test.id(2),'merchant_slug','original-merchant','transaction_type','savings_authorization'));
$$;
INSERT INTO public.merchants VALUES(authorization_test.id(1),'original-merchant');
INSERT INTO public.customers VALUES(authorization_test.id(2),authorization_test.id(1));
INSERT INTO piggyvest_staging.integrations VALUES(authorization_test.id(4),'synthetic-business',true);
INSERT INTO prefunded_card.treasury_bindings(id,integration_id,merchant_id,expected_business_id,source_wallet_id,
  currency,verified_available_kobo,verified_at,authorized_login,enabled) VALUES(
  authorization_test.id(5),authorization_test.id(4),authorization_test.id(1),
  'synthetic-business','source-wallet','NGN',50000,clock_timestamp(),'authorization_worker',true);
INSERT INTO public.customer_savings_goals VALUES(authorization_test.id(3),authorization_test.id(1),
  authorization_test.id(2),1000,0,'active',NULL,NULL,NULL);
INSERT INTO piggyvest_savings_ledger.bindings VALUES(authorization_test.id(3),authorization_test.id(4),
  authorization_test.id(1),authorization_test.id(2),'authorization_worker',true);
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES(authorization_test.id(4),'destination-wallet',
  'destination-customer',authorization_test.id(1),authorization_test.id(2),authorization_test.id(3));
INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,
  request_fingerprint,idempotency_key,saved_method_id,amount_kobo,fee_allowance_kobo,currency,
  collection_reference,transfer_reference,destination_wallet_id,destination_customer_id)
  VALUES(authorization_test.id(8),authorization_test.id(4),authorization_test.id(1),authorization_test.id(2),
  authorization_test.id(3),authorization_test.id(5),'synthetic-fingerprint','synthetic-idempotency',
  authorization_test.id(6),5000,0,'NGN','collection-claim','transfer-claim','destination-wallet','destination-customer');
INSERT INTO public.customer_saved_payment_methods VALUES(
  authorization_test.id(6),authorization_test.id(1),authorization_test.id(2),'paystack',
  'original@example.test','AUTH_synthetic','SIG_synthetic',
  authorization_test.proof()->'authorization',true,true,NULL);
INSERT INTO public.transactions VALUES(
  authorization_test.id(7),authorization_test.id(1),'payment',50,'NGN','completed',
  'paystack','SAV-AUTH-ORIGINAL',authorization_test.proof(),
  (authorization_test.proof()->'metadata') || '{"customer_email":"original@example.test"}'::jsonb);
CREATE TABLE authorization_test.database_pin AS
  SELECT system_identifier::text AS identifier FROM pg_control_system();
GRANT USAGE ON SCHEMA authorization_test TO PUBLIC;
GRANT SELECT ON authorization_test.database_pin TO PUBLIC;
CREATE FUNCTION authorization_test.assert(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'authorization assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION authorization_test.denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM LIKE '%AUTH_%' OR SQLERRM LIKE '%example.test%' THEN
      RAISE EXCEPTION 'authorization failure exposed sensitive fields';
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'authorization operation was not denied';
END $$;
