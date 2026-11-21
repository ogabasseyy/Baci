-- Private storage for the seven-listing BrilStash pilot. A later migration
-- exposes narrow, installation-scoped operations rather than table grants.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.brilstash_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  partner_identity text NOT NULL UNIQUE CHECK (
    partner_identity = btrim(partner_identity)
    AND char_length(partner_identity) BETWEEN 1 AND 256
  ),
  active_generation_id uuid,
  activated_at timestamptz,
  retired_at timestamptz,
  admission text NOT NULL DEFAULT 'unactivated'
    CHECK (admission IN ('unactivated', 'open', 'closed', 'suspended')),
  catalogue_revision bigint NOT NULL DEFAULT 0 CHECK (catalogue_revision >= 0),
  serving_revision bigint NOT NULL DEFAULT 0 CHECK (serving_revision >= 0),
  credential_revision bigint NOT NULL DEFAULT 0 CHECK (credential_revision >= 0),
  CHECK (admission <> 'open' OR (
    activated_at IS NOT NULL AND active_generation_id IS NOT NULL AND retired_at IS NULL
  ))
);

CREATE INDEX brilstash_installations_merchant_idx
  ON private.brilstash_installations (merchant_id);

CREATE TABLE private.brilstash_generations (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expected_active_generation_id uuid,
  catalogue_revision bigint NOT NULL CHECK (catalogue_revision >= 0),
  source_read_at timestamptz NOT NULL,
  staged_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(payload) = 'array' THEN jsonb_array_length(payload) <= 7
      ELSE false END
  ),
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_manifest) = 'array'),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  digest_format text NOT NULL DEFAULT 'canonical-json-sha256-v1'
    CHECK (digest_format = 'canonical-json-sha256-v1'),
  PRIMARY KEY (installation_id, id),
  FOREIGN KEY (installation_id, expected_active_generation_id)
    REFERENCES private.brilstash_generations(installation_id, id)
);

CREATE INDEX brilstash_generations_expected_active_idx
  ON private.brilstash_generations (installation_id, expected_active_generation_id);

ALTER TABLE private.brilstash_installations
  ADD CONSTRAINT brilstash_installations_active_generation_fk
  FOREIGN KEY (id, active_generation_id)
  REFERENCES private.brilstash_generations(installation_id, id);

CREATE TABLE private.brilstash_builder_entitlements (
  installation_id uuid PRIMARY KEY REFERENCES private.brilstash_installations(id),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE private.brilstash_credentials (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bearer_digest bytea NOT NULL UNIQUE CHECK (octet_length(bearer_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz CHECK (expires_at > created_at),
  revoked_at timestamptz CHECK (revoked_at >= created_at),
  PRIMARY KEY (installation_id, id)
);

CREATE FUNCTION private.protect_brilstash_installation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BrilStash installation bindings cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.id, NEW.merchant_id, NEW.partner_identity)
      IS DISTINCT FROM (OLD.id, OLD.merchant_id, OLD.partner_identity)
    OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at)
  THEN
    RAISE EXCEPTION 'BrilStash installation identity and history are permanent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_brilstash_installation
  BEFORE UPDATE OR DELETE ON private.brilstash_installations
  FOR EACH ROW EXECUTE FUNCTION private.protect_brilstash_installation();

CREATE FUNCTION private.protect_brilstash_generation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'BrilStash generation snapshots are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER protect_brilstash_generation
  BEFORE UPDATE OR DELETE ON private.brilstash_generations
  FOR EACH ROW EXECUTE FUNCTION private.protect_brilstash_generation();

ALTER TABLE private.brilstash_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_builder_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_credentials ENABLE ROW LEVEL SECURITY;

-- Direct application roles must never use these relations. A separately
-- authorized RPC owner will use explicit grants and its own scoped policies.
CREATE POLICY brilstash_no_direct_access ON private.brilstash_installations
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_generations
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_builder_entitlements
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_credentials
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE private.brilstash_installations,
  private.brilstash_generations, private.brilstash_builder_entitlements,
  private.brilstash_credentials FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_brilstash_installation(),
  private.protect_brilstash_generation() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.brilstash_installations IS
  'Permanent one-to-one binding to the canonical BrilStash installation identity in this environment.';
COMMENT ON TABLE private.brilstash_generations IS
  'Immutable staged pilot payloads; serving requires a separately authorized active generation.';
