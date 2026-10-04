BEGIN;

CREATE TABLE prefunded_card.checkout_intents (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  deployment text COLLATE "C" NOT NULL CHECK (deployment = 'staging'),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  business_id text COLLATE "C" NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  system_identifier text COLLATE "C" NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  expires_at timestamptz NOT NULL CHECK (expires_at = '2026-09-29T15:59:10Z'::timestamptz),
  database_name name NOT NULL,
  authorized_login name NOT NULL,
  email text COLLATE "C" NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  idempotency_key uuid NOT NULL,
  idempotency_hash text COLLATE "C" NOT NULL UNIQUE CHECK (idempotency_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text COLLATE "C" NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  reference text COLLATE "C" NOT NULL UNIQUE,
  transfer_reference text COLLATE "C" NOT NULL UNIQUE,
  prepared_saved_method_id uuid NOT NULL UNIQUE,
  consent_version text COLLATE "C" NOT NULL CHECK (consent_version = 'prefunded-first-card-v1'),
  consent_one_time_charge boolean NOT NULL CHECK (consent_one_time_charge),
  consent_save_card boolean NOT NULL CHECK (consent_save_card),
  phase text COLLATE "C" NOT NULL DEFAULT 'reserved' CHECK (phase IN (
    'reserved', 'initializing', 'ready', 'pending', 'reconciliation_required', 'funding_pending', 'completed'
  )),
  initialization_fence bigint NOT NULL DEFAULT 0 CHECK (initialization_fence >= 0),
  initialization_token uuid,
  initialization_lease_expires_at timestamptz,
  session_reference text COLLATE "C",
  session_authorization_url text COLLATE "C",
  verified_collection jsonb,
  reconciliation_flagged_at timestamptz,
  reconciliation_flagged_by name,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (id = operation_id),
  CHECK (reference = 'pvb-first-' || id::text),
  CHECK (transfer_reference = 'pvbt-' || id::text),
  CHECK ((session_reference IS NULL) = (session_authorization_url IS NULL)),
  CHECK (session_reference IS NULL OR session_reference = reference),
  CHECK (session_authorization_url IS NULL OR session_authorization_url ~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$'),
  CHECK ((initialization_token IS NULL) = (initialization_lease_expires_at IS NULL)),
  FOREIGN KEY (operation_id) REFERENCES prefunded_card.operations(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX prefunded_first_card_one_unresolved_customer
  ON prefunded_card.checkout_intents(integration_id, merchant_id, customer_id)
  WHERE phase NOT IN ('funding_pending', 'completed');

ALTER TABLE prefunded_card.checkout_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_first_card_checkout_intents_deny ON prefunded_card.checkout_intents
  USING (false) WITH CHECK (false);
REVOKE ALL ON prefunded_card.checkout_intents FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_first_card_checkout_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'first-card checkout intent immutable' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
    'phase', 'initialization_fence', 'initialization_token', 'initialization_lease_expires_at',
    'session_reference', 'session_authorization_url', 'verified_collection',
    'reconciliation_flagged_at', 'reconciliation_flagged_by'
  ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
    'phase', 'initialization_fence', 'initialization_token', 'initialization_lease_expires_at',
    'session_reference', 'session_authorization_url', 'verified_collection',
    'reconciliation_flagged_at', 'reconciliation_flagged_by'
  ]) THEN
    RAISE EXCEPTION 'first-card checkout audit immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.phase NOT IN ('initializing', 'ready', 'pending', 'reconciliation_required', 'funding_pending', 'completed')
    OR OLD.phase IN ('funding_pending', 'completed') AND NEW.phase <> OLD.phase
    OR OLD.phase = 'reserved' AND NEW.phase <> 'initializing'
    OR OLD.phase = 'initializing' AND NEW.phase NOT IN ('ready', 'pending', 'reconciliation_required', 'funding_pending')
    OR OLD.phase = 'ready' AND NEW.phase NOT IN ('pending', 'reconciliation_required', 'funding_pending')
    OR OLD.phase = 'pending' AND NEW.phase NOT IN ('reconciliation_required', 'funding_pending')
    OR OLD.phase = 'reconciliation_required' AND NEW.phase <> 'funding_pending'
    OR OLD.verified_collection IS NOT NULL AND NEW.verified_collection IS DISTINCT FROM OLD.verified_collection
    OR NEW.verified_collection IS NOT NULL AND NEW.phase NOT IN ('funding_pending', 'completed') THEN
    RAISE EXCEPTION 'first-card checkout transition denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_first_card_checkout_intent_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.checkout_intents
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_first_card_checkout_intent();
CREATE TRIGGER prefunded_first_card_checkout_intent_no_truncate
  BEFORE TRUNCATE ON prefunded_card.checkout_intents
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_first_card_checkout_intent();

CREATE FUNCTION prefunded_card.guard_first_card_collection_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM prefunded_card.checkout_intents intent WHERE intent.operation_id = OLD.id)
    AND OLD.collection_status = 'pending'
    AND NEW.collection_status IS DISTINCT FROM OLD.collection_status
    AND (
      NEW.collection_status <> 'verified_success'
      OR NOT pg_has_role(session_user, 'prefunded_authorizer', 'member')
    ) THEN
    RAISE EXCEPTION 'first-card collection requires independent verification' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM prefunded_card.checkout_intents intent WHERE intent.operation_id = OLD.id)
    AND NEW.collection_provider_transaction_id IS DISTINCT FROM OLD.collection_provider_transaction_id
    AND NEW.collection_status <> 'verified_success' THEN
    RAISE EXCEPTION 'first-card collection evidence denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_first_card_collection_transition_guard
  BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_first_card_collection_transition();

REVOKE ALL ON FUNCTION prefunded_card.guard_first_card_checkout_intent(),
  prefunded_card.guard_first_card_collection_transition() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE prefunded_card.checkout_intents IS
  'Private staging-only first-card checkout state. It reserves existing treasury capacity but cannot credit a wallet or savings goal.';
COMMIT;
