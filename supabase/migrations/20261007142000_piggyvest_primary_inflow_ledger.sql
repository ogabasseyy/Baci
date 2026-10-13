BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_evidence') THEN
    CREATE ROLE piggyvest_primary_evidence NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS piggyvest_primary.inflow_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  executor_login name NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE piggyvest_primary.inflow_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_inflow_authorities_deny ON piggyvest_primary.inflow_authorities AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.inflow_authorities FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;

CREATE TABLE IF NOT EXISTS piggyvest_primary.inflow_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL REFERENCES piggyvest_primary.onboarding_intents(id),
  provider_transaction_id text NOT NULL CHECK (octet_length(provider_transaction_id) BETWEEN 1 AND 512),
  event_id text NOT NULL CHECK (octet_length(event_id) BETWEEN 1 AND 512),
  body_digest text NOT NULL CHECK (body_digest ~ '^[a-f0-9]{64}$'),
  financial_identity jsonb NOT NULL,
  wallet_transaction_id uuid NOT NULL REFERENCES public.customer_wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(integration_id, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS primary_inflow_intent_idx ON piggyvest_primary.inflow_receipts(intent_id);
CREATE INDEX IF NOT EXISTS primary_inflow_transaction_idx ON piggyvest_primary.inflow_receipts(wallet_transaction_id);
ALTER TABLE piggyvest_primary.inflow_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_inflow_receipts_deny ON piggyvest_primary.inflow_receipts AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.inflow_receipts FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;

CREATE OR REPLACE FUNCTION piggyvest_primary.apply_inflow(integration_id uuid, receipt jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  binding piggyvest_primary.integrations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  existing piggyvest_primary.inflow_receipts%ROWTYPE;
  identity jsonb;
  receipt_id uuid := pg_catalog.gen_random_uuid();
  transaction_id uuid := pg_catalog.gen_random_uuid();
  wallet_id uuid;
  balance numeric;
  amount numeric;
  field text;
BEGIN
  SELECT integration.* INTO binding FROM piggyvest_primary.integrations integration
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id = integration.id
    WHERE integration.id = apply_inflow.integration_id AND integration.enabled
      AND authority.enabled AND authority.executor_login = SESSION_USER
    FOR SHARE OF integration, authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'inflow authority unavailable' USING ERRCODE = '42501'; END IF;
  IF receipt IS NULL OR jsonb_typeof(receipt) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(receipt)) <> 13
    OR NOT receipt ?& ARRAY['eventId','providerTransactionId','providerCustomerId','providerWalletId','eventDataId','amountKobo','feeKobo','currency','reference','sessionId','creditedAt','financialFingerprint','bodyDigest']
    OR receipt->>'currency' <> 'NGN'
    OR receipt->>'amountKobo' !~ '^[1-9][0-9]*$'
    OR receipt->>'feeKobo' !~ '^[0-9]+$'
    OR receipt->>'financialFingerprint' !~ '^[a-f0-9]{64}$'
    OR receipt->>'bodyDigest' !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'invalid inflow receipt' USING ERRCODE = '22023'; END IF;
  FOREACH field IN ARRAY ARRAY['eventId','providerTransactionId','providerCustomerId','providerWalletId','eventDataId','currency','reference','creditedAt','financialFingerprint','bodyDigest'] LOOP
    IF jsonb_typeof(receipt->field) IS DISTINCT FROM 'string' OR octet_length(receipt->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid inflow field' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(receipt->'amountKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(receipt->'feeKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(receipt->'sessionId') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'invalid inflow amount or session' USING ERRCODE = '22023';
  END IF;
  amount := (receipt->>'amountKobo')::numeric / 100;
  IF amount >= 100000000 THEN RAISE EXCEPTION 'inflow amount outside ledger range' USING ERRCODE = '22023'; END IF;
  PERFORM (receipt->>'creditedAt')::timestamptz;
  SELECT candidate.* INTO intent FROM piggyvest_primary.onboarding_intents candidate
    JOIN public.customers customer ON customer.id = candidate.customer_id AND customer.merchant_id = candidate.merchant_id AND customer.user_id = candidate.user_id
    WHERE candidate.integration_id = binding.id AND candidate.merchant_id = binding.merchant_id
      AND candidate.provider_customer_id = receipt->>'providerCustomerId'
      AND candidate.provider_wallet_id = receipt->>'providerWalletId'
      AND candidate.state IN ('accepted','verified')
    FOR SHARE OF candidate, customer;
  IF NOT FOUND THEN RETURN 'unmapped'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('piggyvest-primary:' || binding.id::text || ':' || (receipt->>'providerTransactionId'), 0));
  identity := receipt - ARRAY['eventId','bodyDigest','financialFingerprint'];
  SELECT stored.* INTO existing FROM piggyvest_primary.inflow_receipts stored
    WHERE stored.integration_id = binding.id AND stored.provider_transaction_id = receipt->>'providerTransactionId';
  IF FOUND THEN
    IF existing.intent_id <> intent.id OR existing.financial_identity <> identity THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance, total_earned)
    VALUES (intent.customer_id, intent.merchant_id, amount, 0)
    ON CONFLICT(customer_id) DO UPDATE SET
      available_balance = public.customer_wallets.available_balance + EXCLUDED.available_balance,
      updated_at = pg_catalog.clock_timestamp()
    WHERE public.customer_wallets.merchant_id = EXCLUDED.merchant_id
    RETURNING id, available_balance INTO wallet_id, balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet ownership mismatch' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,description)
    VALUES (transaction_id,wallet_id,intent.customer_id,intent.merchant_id,'credit',amount,balance,'piggyvest_primary_inflow',receipt_id,'PiggyVest bank transfer');
  INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
    VALUES (receipt_id,binding.id,intent.id,receipt->>'providerTransactionId',receipt->>'eventId',receipt->>'bodyDigest',identity,transaction_id);
  RETURN 'credited';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_inflow(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_inflow(uuid,jsonb) TO piggyvest_primary_evidence;
COMMIT;
