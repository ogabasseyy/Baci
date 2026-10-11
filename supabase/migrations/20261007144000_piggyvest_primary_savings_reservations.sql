BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='piggyvest_primary_authorizer') THEN
    CREATE ROLE piggyvest_primary_authorizer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS piggyvest_primary.savings_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  executor_login name UNIQUE NOT NULL, enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS piggyvest_primary.savings_destinations (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  intent_id uuid NOT NULL REFERENCES piggyvest_primary.onboarding_intents(id),
  provider_wallet_id text NOT NULL CHECK(octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY(integration_id,goal_id), UNIQUE(integration_id,provider_wallet_id)
);
CREATE INDEX IF NOT EXISTS primary_savings_destination_goal_idx ON piggyvest_primary.savings_destinations(goal_id);
CREATE INDEX IF NOT EXISTS primary_savings_destination_intent_idx ON piggyvest_primary.savings_destinations(intent_id);
CREATE TABLE IF NOT EXISTS piggyvest_primary.savings_operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL REFERENCES piggyvest_primary.onboarding_intents(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9999999999),
  source_wallet_id text NOT NULL, destination_wallet_id text NOT NULL,
  reference text UNIQUE NOT NULL,
  state text NOT NULL CHECK(state IN ('reserved','dispatched','confirmed','cancelled')),
  wallet_transaction_id uuid NOT NULL REFERENCES public.customer_wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK(source_wallet_id <> destination_wallet_id)
);
CREATE INDEX IF NOT EXISTS primary_savings_operation_integration_idx ON piggyvest_primary.savings_operations(integration_id);
CREATE INDEX IF NOT EXISTS primary_savings_operation_intent_idx ON piggyvest_primary.savings_operations(intent_id);
CREATE INDEX IF NOT EXISTS primary_savings_operation_goal_idx ON piggyvest_primary.savings_operations(goal_id);
CREATE INDEX IF NOT EXISTS primary_savings_operation_transaction_idx ON piggyvest_primary.savings_operations(wallet_transaction_id);
ALTER TABLE piggyvest_primary.savings_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.savings_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.savings_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_savings_authorities_deny ON piggyvest_primary.savings_authorities AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_savings_destinations_deny ON piggyvest_primary.savings_destinations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_savings_operations_deny ON piggyvest_primary.savings_operations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.savings_authorities,piggyvest_primary.savings_destinations,piggyvest_primary.savings_operations FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_authorizer;

CREATE OR REPLACE FUNCTION piggyvest_primary.assert_savings_scope(scope jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE intent_id uuid;
BEGIN
  IF scope IS NULL OR jsonb_typeof(scope)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(scope))<>6 THEN
    RAISE EXCEPTION 'invalid savings scope' USING ERRCODE='42501';
  END IF;
  SELECT intent.id INTO intent_id FROM piggyvest_primary.onboarding_intents intent
    JOIN piggyvest_primary.integrations binding ON binding.id=intent.integration_id AND binding.merchant_id=intent.merchant_id
    JOIN piggyvest_primary.savings_authorities authority ON authority.integration_id=binding.id
    JOIN public.customers customer ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
      AND binding.id=(scope->>'integrationId')::uuid AND binding.merchant_id=(scope->>'merchantId')::uuid
      AND binding.business_id=scope->>'businessId' AND binding.environment=scope->>'environment'
      AND intent.customer_id=(scope->>'customerId')::uuid AND intent.user_id=(scope->>'userId')::uuid
      AND intent.state IN ('accepted','verified')
    FOR SHARE OF intent,binding,authority,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings ownership unavailable' USING ERRCODE='42501'; END IF;
  RETURN intent_id;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid := piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  goal public.customer_savings_goals%ROWTYPE;
  destination piggyvest_primary.savings_destinations%ROWTYPE;
  amount bigint;
  available_kobo numeric;
  capacity_kobo numeric;
  wallet_id uuid;
  wallet_balance numeric;
  transaction_id uuid:=pg_catalog.gen_random_uuid();
  source_wallet text;
BEGIN
  IF request IS NULL OR jsonb_typeof(request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(request))<>3
    OR NOT request ?& ARRAY['goalId','operationId','amountKobo'] OR jsonb_typeof(request->'amountKobo') IS DISTINCT FROM 'number'
    OR request->>'amountKobo' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid savings request' USING ERRCODE='22023'; END IF;
  amount:=(request->>'amountKobo')::bigint;
  IF amount>9999999999 THEN RAISE EXCEPTION 'savings amount outside ledger range' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || resolved_intent_id::text,0));
  SELECT * INTO operation FROM piggyvest_primary.savings_operations WHERE id=(request->>'operationId')::uuid FOR UPDATE;
  IF FOUND THEN
    IF operation.intent_id<>resolved_intent_id OR operation.goal_id<>(request->>'goalId')::uuid OR operation.amount_kobo<>amount THEN RETURN jsonb_build_object('status','conflict'); END IF;
    RETURN jsonb_build_object('status',CASE WHEN operation.state='confirmed' THEN 'confirmed' WHEN operation.state='cancelled' THEN 'conflict' ELSE 'pending' END);
  END IF;
  SELECT candidate.* INTO goal FROM public.customer_savings_goals candidate
    WHERE candidate.id=(request->>'goalId')::uuid AND candidate.customer_id=(scope->>'customerId')::uuid
      AND candidate.merchant_id=(scope->>'merchantId')::uuid AND candidate.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE='42501'; END IF;
  SELECT candidate.* INTO destination FROM piggyvest_primary.savings_destinations candidate
    WHERE candidate.integration_id=(scope->>'integrationId')::uuid AND candidate.goal_id=goal.id AND candidate.intent_id=resolved_intent_id AND candidate.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings destination unavailable' USING ERRCODE='42501'; END IF;
  SELECT provider_wallet_id INTO source_wallet FROM piggyvest_primary.onboarding_intents WHERE id=resolved_intent_id;
  IF source_wallet=destination.provider_wallet_id THEN RAISE EXCEPTION 'identical savings wallets' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(sum((financial_identity->>'amountKobo')::numeric),0) INTO available_kobo FROM piggyvest_primary.inflow_receipts WHERE inflow_receipts.intent_id=resolved_intent_id;
  SELECT available_kobo-COALESCE(sum(amount_kobo),0) INTO available_kobo FROM piggyvest_primary.savings_operations WHERE savings_operations.intent_id=resolved_intent_id AND state<>'cancelled';
  SELECT (goal.target_amount-goal.current_amount)*100-COALESCE(sum(amount_kobo),0) INTO capacity_kobo FROM piggyvest_primary.savings_operations WHERE goal_id=goal.id AND state IN ('reserved','dispatched');
  IF available_kobo<amount OR capacity_kobo<amount THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  UPDATE public.customer_wallets SET available_balance=available_balance-amount::numeric/100,updated_at=pg_catalog.clock_timestamp()
    WHERE customer_id=(scope->>'customerId')::uuid AND merchant_id=(scope->>'merchantId')::uuid AND available_balance>=amount::numeric/100
    RETURNING id,available_balance INTO wallet_id,wallet_balance;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,status,description)
    VALUES(transaction_id,wallet_id,(scope->>'customerId')::uuid,(scope->>'merchantId')::uuid,'redemption',amount::numeric/100,wallet_balance,'piggyvest_primary_savings',(request->>'operationId')::uuid,'pending','Savings transfer pending');
  INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id)
    VALUES((request->>'operationId')::uuid,(scope->>'integrationId')::uuid,resolved_intent_id,goal.id,amount,source_wallet,destination.provider_wallet_id,'pvb-save-' || (request->>'operationId'),'reserved',transaction_id)
    RETURNING * INTO operation;
  RETURN jsonb_build_object('status','claimed','reservation',jsonb_build_object('operationId',operation.id,'goalId',goal.id,'amountKobo',amount,'sourceWalletId',source_wallet,'destinationWalletId',destination.provider_wallet_id,'reference',operation.reference,'businessId',scope->>'businessId'));
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.assert_savings_scope(jsonb),piggyvest_primary.reserve_savings(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_savings(jsonb,jsonb) TO piggyvest_primary_authorizer;
COMMIT;
