BEGIN;

CREATE SCHEMA IF NOT EXISTS piggyvest_staging;
REVOKE ALL ON SCHEMA piggyvest_staging FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA piggyvest_staging REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA piggyvest_staging REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_staging.inbox (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL,
  provider_event_id text COLLATE "C" NOT NULL CHECK (pg_catalog.octet_length(provider_event_id) BETWEEN 1 AND 512),
  raw_body bytea NOT NULL CHECK (pg_catalog.octet_length(raw_body) <= 65536),
  fingerprint bytea GENERATED ALWAYS AS (pg_catalog.sha256(raw_body)) STORED NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'processed', 'quarantined', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  claim_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (integration_id, provider_event_id),
  CHECK ((status = 'leased' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND claim_token IS NULL AND lease_expires_at IS NULL))
);
ALTER TABLE piggyvest_staging.inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_staging.inbox FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX piggyvest_staging_inbox_pending_idx
  ON piggyvest_staging.inbox (integration_id, available_at, id) WHERE status = 'pending';
CREATE INDEX piggyvest_staging_inbox_leased_idx
  ON piggyvest_staging.inbox (integration_id, lease_expires_at, id) WHERE status = 'leased';

CREATE FUNCTION piggyvest_staging.enqueue_inbox(
  p_integration_id uuid, p_provider_event_id text, p_raw_body bytea
) RETURNS TABLE (inbox_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_id uuid;
  stored_body bytea;
BEGIN
  IF p_integration_id IS NULL OR p_provider_event_id IS NULL
    OR pg_catalog.octet_length(p_provider_event_id) NOT BETWEEN 1 AND 512
    OR p_raw_body IS NULL OR pg_catalog.octet_length(p_raw_body) > 65536 THEN
    RAISE EXCEPTION 'invalid inbox input' USING ERRCODE = '22023';
  END IF;
  INSERT INTO piggyvest_staging.inbox (integration_id, provider_event_id, raw_body)
    VALUES (p_integration_id, p_provider_event_id, p_raw_body)
    ON CONFLICT (integration_id, provider_event_id) DO NOTHING
    RETURNING id INTO stored_id;
  IF stored_id IS NOT NULL THEN
    RETURN QUERY SELECT stored_id, 'enqueued'::text;
    RETURN;
  END IF;
  SELECT entry.id, entry.raw_body INTO stored_id, stored_body
    FROM piggyvest_staging.inbox AS entry
    WHERE entry.integration_id = p_integration_id AND entry.provider_event_id = p_provider_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retry inbox enqueue transaction' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT stored_id, CASE WHEN stored_body = p_raw_body THEN 'duplicate' ELSE 'conflict' END;
END $$;

CREATE FUNCTION piggyvest_staging.claim_inbox(
  p_integration_id uuid, p_batch_size integer, p_lease_seconds integer
) RETURNS TABLE (
  inbox_id uuid, provider_event_id text, raw_body bytea, fingerprint bytea,
  claim_token uuid, attempts integer, lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid inbox claim input' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH candidates AS MATERIALIZED (
      SELECT entry.id
      FROM piggyvest_staging.inbox AS entry
      WHERE entry.integration_id = p_integration_id
        AND ((entry.status = 'pending' AND entry.available_at <= pg_catalog.clock_timestamp())
          OR (entry.status = 'leased' AND entry.lease_expires_at <= pg_catalog.clock_timestamp()))
      ORDER BY entry.available_at, entry.id
      LIMIT p_batch_size FOR UPDATE SKIP LOCKED
    ), changed AS (
      UPDATE piggyvest_staging.inbox AS entry SET
        status = CASE WHEN entry.attempts >= 5 THEN 'dead_letter' ELSE 'leased' END,
        attempts = LEAST(entry.attempts + 1, 5),
        claim_token = CASE WHEN entry.attempts < 5 THEN pg_catalog.gen_random_uuid() ELSE NULL END,
        lease_expires_at = CASE WHEN entry.attempts < 5
          THEN pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds) ELSE NULL END,
        updated_at = pg_catalog.clock_timestamp()
      FROM candidates WHERE entry.id = candidates.id
      RETURNING entry.id, entry.provider_event_id, entry.raw_body, entry.fingerprint,
        entry.claim_token, entry.attempts, entry.lease_expires_at, entry.status
    )
    SELECT changed.id, changed.provider_event_id, changed.raw_body, changed.fingerprint,
      changed.claim_token, changed.attempts, changed.lease_expires_at
    FROM changed WHERE changed.status = 'leased';
END $$;

CREATE FUNCTION piggyvest_staging.finish_inbox(
  p_integration_id uuid, p_inbox_id uuid, p_claim_token uuid, p_outcome text, p_retry_seconds integer
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  entry piggyvest_staging.inbox%ROWTYPE;
  next_status text;
BEGIN
  IF p_integration_id IS NULL OR p_inbox_id IS NULL OR p_claim_token IS NULL
    OR p_outcome IS NULL OR p_outcome NOT IN ('processed', 'unsupported', 'retry')
    OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 0 AND 3600
    OR (p_outcome <> 'retry' AND p_retry_seconds <> 0) THEN
    RAISE EXCEPTION 'invalid inbox finish input' USING ERRCODE = '22023';
  END IF;
  SELECT stored.* INTO entry FROM piggyvest_staging.inbox AS stored
    WHERE stored.integration_id = p_integration_id AND stored.id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF entry.status <> 'leased' OR entry.claim_token IS DISTINCT FROM p_claim_token
    OR entry.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN 'stale';
  END IF;
  next_status := CASE p_outcome
    WHEN 'processed' THEN 'processed'
    WHEN 'unsupported' THEN 'quarantined'
    ELSE CASE WHEN entry.attempts >= 5 THEN 'dead_letter' ELSE 'pending' END
  END;
  UPDATE piggyvest_staging.inbox AS stored SET
    status = next_status, claim_token = NULL, lease_expires_at = NULL,
    available_at = CASE WHEN next_status = 'pending'
      THEN pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_retry_seconds)
      ELSE stored.available_at END,
    updated_at = pg_catalog.clock_timestamp()
    WHERE stored.id = entry.id;
  RETURN next_status;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA piggyvest_staging IS
  'Inactive staging-only inbox. No deployed caller grants. Integration UUID must come from future trusted server configuration, never webhook fields.';
COMMENT ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea) IS
  'Atomic raw-byte persistence and enqueue; event ID is opaque 1..512 bytes, body 0..65536 bytes. Returns inbox_id and enqueued|duplicate|conflict without overwriting. Commit before acknowledging delivery; retry SQLSTATE 40001.';
COMMENT ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer) IS
  'Integration-scoped batch 1..100, lease 1..300 seconds. Returns raw bytes, SHA256 bytes, random claim token, attempts, expiry. Five total attempts including lease expiry. Exhausted rows consume batch slots and become dead_letter; an empty batch need not mean drained.';
COMMENT ON FUNCTION piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer) IS
  'Requires matching integration, inbox ID, unexpired token. Outcomes processed|unsupported|retry; retry delay 0..3600 seconds, otherwise zero. Returns processed|quarantined|pending|dead_letter|stale. Unsupported events quarantine; processed records completion only, never financial effects.';

COMMIT;
