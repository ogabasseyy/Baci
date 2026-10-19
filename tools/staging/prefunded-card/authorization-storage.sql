BEGIN;
CREATE TABLE prefunded_card.authorization_bindings (
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  saved_method_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  transaction_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  provider_reference text COLLATE "C" NOT NULL,
  email text COLLATE "C" NOT NULL,
  authorization_code text COLLATE "C" NOT NULL,
  authorization_signature text COLLATE "C" NOT NULL,
  paystack_customer_code text COLLATE "C" NOT NULL,
  domain text COLLATE "C" NOT NULL CHECK (domain='test'),
  reusable boolean NOT NULL CHECK (reusable),
  authorized_login name NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  database_name name NOT NULL,
  provisioned_by name NOT NULL,
  provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (treasury_binding_id,saved_method_id),
  UNIQUE (treasury_binding_id,transaction_id),
  CHECK (length(authorization_code) BETWEEN 6 AND 512 AND authorization_code ~ '^AUTH_[A-Za-z0-9_]+$'),
  CHECK (length(paystack_customer_code) BETWEEN 5 AND 512 AND paystack_customer_code ~ '^CUS_[A-Za-z0-9_]+$'),
  CHECK (length(email) BETWEEN 3 AND 254 AND email !~ '[[:space:][:cntrl:]]'),
  CHECK (length(authorization_signature) BETWEEN 1 AND 512 AND authorization_signature !~ '[[:space:][:cntrl:]]'),
  CHECK (provider_transaction_id ~ '^[1-9][0-9]{0,19}$' AND provider_transaction_id::numeric<=18446744073709551615),
  CHECK (length(provider_reference) BETWEEN 1 AND 128 AND provider_reference ~ '^[A-Za-z0-9.=-]+$')
);
CREATE INDEX authorization_binding_integration_idx ON prefunded_card.authorization_bindings(integration_id);
CREATE INDEX authorization_binding_merchant_idx ON prefunded_card.authorization_bindings(merchant_id);
CREATE INDEX authorization_binding_customer_idx ON prefunded_card.authorization_bindings(customer_id);
ALTER TABLE prefunded_card.authorization_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.authorization_bindings FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION prefunded_card.guard_authorization_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END $$;
CREATE TRIGGER authorization_binding_immutable BEFORE UPDATE OR DELETE ON prefunded_card.authorization_bindings
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_authorization_binding();
CREATE TRIGGER authorization_binding_no_truncate BEFORE TRUNCATE ON prefunded_card.authorization_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_authorization_binding();
REVOKE ALL ON FUNCTION prefunded_card.guard_authorization_binding() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE prefunded_card.authorization_bindings IS
  'Private immutable proof for an existing saved card, populated only after restricted test Paystack verification. Not a public card catalog; survives removal or mutation of the original card for historical verification.';
COMMIT;
