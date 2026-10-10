BEGIN;
CREATE SCHEMA IF NOT EXISTS piggyvest_primary_card;
REVOKE ALL ON SCHEMA piggyvest_primary_card FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='primary_card_authorizer') THEN
    CREATE ROLE primary_card_authorizer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='primary_card_evidence') THEN
    CREATE ROLE primary_card_evidence NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE piggyvest_primary_card.settings (
  integration_id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  environment text NOT NULL CHECK(environment IN ('staging','production')),
  business_id text NOT NULL CHECK(octet_length(business_id) BETWEEN 1 AND 512),
  authorizer_login name NOT NULL UNIQUE,
  evidence_login name NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  callback_url text NOT NULL CHECK(callback_url ~ '^https://[^/?#@:]+(/[^?#]*)?$'),
  enabled boolean NOT NULL DEFAULT false,
  CHECK(authorizer_login <> evidence_login),
  FOREIGN KEY(integration_id,merchant_id) REFERENCES piggyvest_primary.integrations(id,merchant_id)
);
CREATE INDEX primary_card_settings_merchant_idx ON piggyvest_primary_card.settings(merchant_id);
ALTER TABLE piggyvest_primary_card.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_settings_deny ON piggyvest_primary_card.settings AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);

CREATE TABLE piggyvest_primary_card.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary_card.settings(integration_id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  user_id uuid NOT NULL,
  environment text NOT NULL CHECK(environment IN ('staging','production')),
  business_id text NOT NULL,
  email text NOT NULL CHECK(octet_length(email) BETWEEN 3 AND 254),
  idempotency_key uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9999999999),
  consent jsonb NOT NULL CHECK(consent @> '{"version":"primary-wallet-card-v1","oneTimeCharge":true}'::jsonb AND jsonb_typeof(consent->'saveCard')='boolean'),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  destination_wallet_id text NOT NULL,
  destination_customer_id text NOT NULL,
  state text NOT NULL CHECK(state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required')),
  claim_token uuid,
  authorization_url text CHECK(authorization_url ~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(integration_id,customer_id,idempotency_key),
  CHECK((state='initializing') = (claim_token IS NOT NULL))
);
CREATE INDEX primary_card_operations_integration_idx ON piggyvest_primary_card.operations(integration_id);
CREATE INDEX primary_card_operations_merchant_idx ON piggyvest_primary_card.operations(merchant_id);
CREATE INDEX primary_card_operations_customer_idx ON piggyvest_primary_card.operations(customer_id);
CREATE UNIQUE INDEX primary_card_one_unresolved_idx ON piggyvest_primary_card.operations(integration_id,customer_id)
  WHERE state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required');
ALTER TABLE piggyvest_primary_card.operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_operations_deny ON piggyvest_primary_card.operations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);

CREATE TABLE piggyvest_primary_card.collections (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.operations(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary_card.settings(integration_id),
  environment text NOT NULL CHECK(environment IN ('staging','production')),
  provider_transaction_id text NOT NULL CHECK(provider_transaction_id ~ '^[1-9][0-9]{0,19}$' AND provider_transaction_id::numeric <= 18446744073709551615),
  evidence jsonb NOT NULL,
  saved_token jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(environment,integration_id,provider_transaction_id)
);
CREATE INDEX primary_card_collections_integration_idx ON piggyvest_primary_card.collections(integration_id);
ALTER TABLE piggyvest_primary_card.collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_collections_deny ON piggyvest_primary_card.collections AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON ALL TABLES IN SCHEMA piggyvest_primary_card FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence;

CREATE FUNCTION piggyvest_primary_card.assert_scope(scope jsonb, evidence_role boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(scope) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(scope)) <> 9 THEN
    RAISE EXCEPTION 'invalid card scope' USING ERRCODE='42501';
  END IF;
  PERFORM config.integration_id FROM piggyvest_primary_card.settings config
  JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id AND integration.merchant_id=config.merchant_id
  JOIN public.customers customer ON customer.merchant_id=config.merchant_id
  WHERE config.integration_id=(scope->>'integrationId')::uuid
    AND config.merchant_id=(scope->>'merchantId')::uuid AND config.environment=scope->>'environment'
    AND config.business_id=scope->>'businessId' AND integration.business_id=config.business_id
    AND integration.environment=config.environment AND integration.enabled AND config.enabled
    AND config.expires_at > clock_timestamp() AND config.expires_at=(scope->>'expiresAt')::timestamptz
    AND config.callback_url=scope->>'callbackUrl'
    AND SESSION_USER=CASE WHEN evidence_role THEN config.evidence_login ELSE config.authorizer_login END
    AND customer.id=(scope->>'customerId')::uuid AND customer.user_id=(scope->>'userId')::uuid
    AND lower(customer.email)=scope->>'email'
  FOR SHARE OF config,integration,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'card ownership unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION piggyvest_primary_card.project(operation piggyvest_primary_card.operations)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('operationId',operation.id,'environment',operation.environment,
    'integrationId',operation.integration_id,'merchantId',operation.merchant_id,'customerId',operation.customer_id,
    'userId',operation.user_id,'businessId',operation.business_id,'email',operation.email,
    'amountKobo',operation.amount_kobo,'consent',operation.consent,
    'reference','pvb-first-primary-'||operation.id::text,'fingerprint',operation.fingerprint,
    'destinationWalletId',operation.destination_wallet_id,'destinationCustomerId',operation.destination_customer_id,
    'status',operation.state,'authorizationUrl',operation.authorization_url);
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA piggyvest_primary_card FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence;
GRANT USAGE ON SCHEMA piggyvest_primary_card TO primary_card_authorizer,primary_card_evidence;
COMMIT;
