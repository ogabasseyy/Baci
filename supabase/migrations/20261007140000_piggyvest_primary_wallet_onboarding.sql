BEGIN;
CREATE SCHEMA IF NOT EXISTS piggyvest_primary;
REVOKE ALL ON SCHEMA piggyvest_primary FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_provisioner') THEN
    CREATE ROLE piggyvest_primary_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS piggyvest_primary.integrations (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  business_id text NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  executor_login name NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE(id, merchant_id)
);
CREATE INDEX IF NOT EXISTS piggyvest_primary_integrations_merchant_idx ON piggyvest_primary.integrations(merchant_id);
ALTER TABLE piggyvest_primary.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_integrations_deny ON piggyvest_primary.integrations AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.integrations FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_provisioner;

CREATE TABLE IF NOT EXISTS piggyvest_primary.onboarding_intents (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  user_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('dispatched', 'accepted', 'unknown', 'verified')),
  claim_token uuid,
  provider_customer_id text CHECK (octet_length(provider_customer_id) BETWEEN 1 AND 512),
  provider_wallet_id text CHECK (octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY(integration_id, merchant_id) REFERENCES piggyvest_primary.integrations(id, merchant_id),
  UNIQUE(integration_id, customer_id),
  UNIQUE(integration_id, provider_customer_id),
  UNIQUE(integration_id, provider_wallet_id),
  CHECK ((state = 'dispatched' AND claim_token IS NOT NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)
    OR (state = 'unknown' AND claim_token IS NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL)
    OR (state IN ('accepted', 'verified') AND claim_token IS NULL AND provider_customer_id IS NOT NULL AND provider_wallet_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS piggyvest_primary_intents_merchant_idx ON piggyvest_primary.onboarding_intents(merchant_id);
CREATE INDEX IF NOT EXISTS piggyvest_primary_intents_customer_idx ON piggyvest_primary.onboarding_intents(customer_id);
ALTER TABLE piggyvest_primary.onboarding_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_intents_deny ON piggyvest_primary.onboarding_intents AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.onboarding_intents FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_provisioner;

CREATE OR REPLACE FUNCTION piggyvest_primary.assert_onboarding_scope(scope jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF jsonb_typeof(scope) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(scope)) <> 6 THEN
    RAISE EXCEPTION 'invalid onboarding scope' USING ERRCODE = '42501';
  END IF;
  PERFORM integration.id FROM piggyvest_primary.integrations integration
  JOIN public.customers customer ON customer.merchant_id = integration.merchant_id
  WHERE integration.id = (scope->>'integrationId')::uuid
    AND integration.merchant_id = (scope->>'merchantId')::uuid
    AND integration.business_id = scope->>'businessId'
    AND integration.environment = scope->>'environment'
    AND integration.executor_login = SESSION_USER AND integration.enabled
    AND customer.id = (scope->>'customerId')::uuid
    AND customer.user_id = (scope->>'userId')::uuid
  FOR SHARE OF integration, customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'onboarding ownership unavailable' USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.claim_onboarding(scope jsonb, fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF fingerprint IS NULL OR fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid onboarding fingerprint' USING ERRCODE = '22023';
  END IF;
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id, merchant_id, customer_id, user_id, request_fingerprint, state, claim_token)
  VALUES ((scope->>'integrationId')::uuid, (scope->>'merchantId')::uuid, (scope->>'customerId')::uuid,
    (scope->>'userId')::uuid, fingerprint, 'dispatched', pg_catalog.gen_random_uuid())
  ON CONFLICT(integration_id, customer_id) DO NOTHING RETURNING * INTO intent;
  IF FOUND THEN
    RETURN jsonb_build_object('status','claimed','intentId',intent.id,'claimToken',intent.claim_token);
  END IF;
  SELECT * INTO STRICT intent FROM piggyvest_primary.onboarding_intents
    WHERE integration_id = (scope->>'integrationId')::uuid AND customer_id = (scope->>'customerId')::uuid FOR UPDATE;
  IF intent.user_id <> (scope->>'userId')::uuid OR intent.request_fingerprint <> fingerprint THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN intent.state = 'verified' THEN 'ready' ELSE 'pending' END);
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.record_onboarding(scope jsonb, intent_id uuid, token uuid, provider_customer text, provider_wallet text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  IF (provider_customer IS NULL) <> (provider_wallet IS NULL) THEN
    RAISE EXCEPTION 'incomplete provider identity' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.onboarding_intents SET
    state = CASE WHEN provider_customer IS NULL THEN 'unknown' ELSE 'accepted' END,
    claim_token = NULL, provider_customer_id = provider_customer, provider_wallet_id = provider_wallet,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = intent_id AND integration_id = (scope->>'integrationId')::uuid
    AND merchant_id = (scope->>'merchantId')::uuid AND customer_id = (scope->>'customerId')::uuid
    AND user_id = (scope->>'userId')::uuid AND state = 'dispatched' AND claim_token = token;
  RETURN FOUND;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA piggyvest_primary FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_onboarding(jsonb,text), piggyvest_primary.record_onboarding(jsonb,uuid,uuid,text,text) TO piggyvest_primary_provisioner;
COMMIT;
