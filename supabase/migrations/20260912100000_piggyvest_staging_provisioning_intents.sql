BEGIN;

CREATE TABLE piggyvest_staging.provisioning_integrations (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE (integration_id, merchant_id)
);
CREATE INDEX piggyvest_staging_provisioning_integrations_merchant_idx
  ON piggyvest_staging.provisioning_integrations (merchant_id);
ALTER TABLE piggyvest_staging.provisioning_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioning_integrations_deny ON piggyvest_staging.provisioning_integrations
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_staging.provisioning_integrations FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_staging.provisioning_intents (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid REFERENCES public.customer_savings_goals(id),
  operation text NOT NULL CHECK (operation IN ('create_customer', 'create_plan_wallet')),
  request_fingerprint bytea NOT NULL CHECK (pg_catalog.octet_length(request_fingerprint) = 32),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'unknown', 'awaiting_confirmation')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts IN (0, 1)),
  claim_token uuid,
  lease_expires_at timestamptz,
  result_code text CHECK (result_code IN
    ('accepted', 'timeout', 'transport_error', 'rejected', 'ambiguous', 'lease_expired')),
  provider_reference_hash bytea CHECK (pg_catalog.octet_length(provider_reference_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (integration_id, merchant_id)
    REFERENCES piggyvest_staging.provisioning_integrations(integration_id, merchant_id),
  CHECK ((operation = 'create_customer' AND goal_id IS NULL)
    OR (operation = 'create_plan_wallet' AND goal_id IS NOT NULL)),
  CHECK ((status = 'pending' AND attempts = 0 AND claim_token IS NULL AND lease_expires_at IS NULL
      AND result_code IS NULL AND provider_reference_hash IS NULL)
    OR (status = 'dispatched' AND attempts = 1 AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND result_code IS NULL AND provider_reference_hash IS NULL)
    OR (status = 'unknown' AND attempts = 1 AND claim_token IS NULL AND lease_expires_at IS NULL
      AND result_code IS NOT NULL AND result_code <> 'accepted')
    OR (status = 'awaiting_confirmation' AND attempts = 1 AND claim_token IS NULL AND lease_expires_at IS NULL
      AND result_code IS NOT NULL AND result_code = 'accepted'))
);
CREATE UNIQUE INDEX piggyvest_staging_provisioning_customer_unique
  ON piggyvest_staging.provisioning_intents (integration_id, customer_id) WHERE operation = 'create_customer';
CREATE UNIQUE INDEX piggyvest_staging_provisioning_goal_unique
  ON piggyvest_staging.provisioning_intents (integration_id, goal_id) WHERE operation = 'create_plan_wallet';
CREATE INDEX piggyvest_staging_provisioning_merchant_idx ON piggyvest_staging.provisioning_intents (merchant_id);
CREATE INDEX piggyvest_staging_provisioning_customer_idx ON piggyvest_staging.provisioning_intents (customer_id);
CREATE INDEX piggyvest_staging_provisioning_goal_idx ON piggyvest_staging.provisioning_intents (goal_id);
ALTER TABLE piggyvest_staging.provisioning_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioning_intents_deny ON piggyvest_staging.provisioning_intents
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_staging.provisioning_intents FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_staging.guard_provisioning_integration()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'immutable provisioning integration' USING ERRCODE = '23514';
  END IF;
  IF NEW.integration_id IS DISTINCT FROM OLD.integration_id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'immutable provisioning integration' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provisioning_integration_rows
  BEFORE UPDATE OR DELETE ON piggyvest_staging.provisioning_integrations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_provisioning_integration();
CREATE TRIGGER guard_provisioning_integration_truncate
  BEFORE TRUNCATE ON piggyvest_staging.provisioning_integrations
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_staging.guard_provisioning_integration();

CREATE FUNCTION piggyvest_staging.provisioning_owner_matches(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM binding.integration_id FROM piggyvest_staging.provisioning_integrations AS binding
    JOIN piggyvest_staging.integrations AS registry ON registry.id = binding.integration_id
    WHERE binding.integration_id = p_integration_id AND binding.merchant_id = p_merchant_id
      AND binding.enabled AND registry.enabled FOR SHARE OF binding, registry;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer_id AND customer.merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_goal_id IS NOT NULL THEN
    PERFORM goal.id FROM public.customer_savings_goals AS goal
      WHERE goal.id = p_goal_id AND goal.customer_id = p_customer_id AND goal.merchant_id = p_merchant_id FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION piggyvest_staging.guard_provisioning_intent()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'durable provisioning identity cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NOT piggyvest_staging.provisioning_owner_matches(
      NEW.integration_id, NEW.merchant_id, NEW.customer_id, NEW.goal_id) THEN
      RAISE EXCEPTION 'invalid provisioning ownership or initial state' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.integration_id, NEW.merchant_id, NEW.customer_id, NEW.goal_id,
      NEW.operation, NEW.request_fingerprint, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.integration_id, OLD.merchant_id, OLD.customer_id, OLD.goal_id,
      OLD.operation, OLD.request_fingerprint, OLD.created_at) THEN
    RAISE EXCEPTION 'immutable provisioning identity' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status = 'dispatched')
    OR (OLD.status = 'dispatched' AND NEW.status IN ('unknown', 'awaiting_confirmation'))) THEN
    RAISE EXCEPTION 'invalid provisioning transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provisioning_intent_rows
  BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_staging.provisioning_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_provisioning_intent();
CREATE TRIGGER guard_provisioning_intent_truncate
  BEFORE TRUNCATE ON piggyvest_staging.provisioning_intents
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_staging.guard_provisioning_intent();

REVOKE ALL ON FUNCTION piggyvest_staging.guard_provisioning_integration() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.provisioning_owner_matches(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.guard_provisioning_intent() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_staging.provisioning_integrations IS
  'Owner-only staging provisioning scope. No seeded integrations or grants. Binding is immutable; both this disabled-by-default scope and the existing integration registry must be enabled explicitly. Caller integration and expected merchant must come from trusted server configuration.';
COMMENT ON TABLE piggyvest_staging.provisioning_intents IS
  'Durable single-POST application identity: id is the local request ID, not a provider idempotency guarantee. One create_customer per integration/customer; one create_plan_wallet per integration/goal. Store only a 32-byte HMAC-SHA256 fingerprint of versioned canonical request plus local identity and business, supplied by a trusted server with a separate secret key. Never store the key, raw requests, KYC, BVN, email, phone, credentials, or unkeyed hashes of sensitive inputs. Provider references are SHA256 opaque-ID digests only, not raw payloads or messages. No completed status: independently verified reconciliation is a separate tranche.';

COMMIT;
