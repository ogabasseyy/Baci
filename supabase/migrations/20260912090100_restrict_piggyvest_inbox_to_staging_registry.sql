BEGIN;

CREATE TABLE piggyvest_staging.integrations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  expected_provider_account_id text COLLATE "C" NOT NULL UNIQUE
    CHECK (pg_catalog.octet_length(expected_provider_account_id) BETWEEN 1 AND 512),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE piggyvest_staging.integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_staging.integrations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE piggyvest_staging.inbox ADD CONSTRAINT piggyvest_staging_inbox_integration_fk
  FOREIGN KEY (integration_id) REFERENCES piggyvest_staging.integrations(id);

CREATE OR REPLACE FUNCTION piggyvest_staging.enqueue_inbox(
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
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive staging integration' USING ERRCODE = '22023';
  END IF;
  INSERT INTO piggyvest_staging.inbox (integration_id, provider_event_id, raw_body)
    VALUES (p_integration_id, p_provider_event_id, p_raw_body)
    ON CONFLICT (integration_id, provider_event_id) DO NOTHING
    RETURNING id INTO stored_id;
  IF stored_id IS NOT NULL THEN
    RETURN QUERY SELECT stored_id, 'accepted'::text;
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

CREATE OR REPLACE FUNCTION piggyvest_staging.claim_inbox(
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
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION piggyvest_staging.finish_inbox(
  p_integration_id uuid, p_inbox_id uuid, p_claim_token uuid, p_outcome text, p_retry_seconds integer
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  stored_status text;
  stored_token uuid;
  stored_expiry timestamptz;
  stored_attempts integer;
  next_status text;
BEGIN
  IF p_integration_id IS NULL OR p_inbox_id IS NULL OR p_claim_token IS NULL
    OR p_outcome IS NULL OR p_outcome NOT IN ('unsupported', 'retry')
    OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 0 AND 3600
    OR (p_outcome <> 'retry' AND p_retry_seconds <> 0) THEN
    RAISE EXCEPTION 'invalid inbox finish input' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT stored.status, stored.claim_token, stored.lease_expires_at, stored.attempts
    INTO stored_status, stored_token, stored_expiry, stored_attempts
    FROM piggyvest_staging.inbox AS stored
    WHERE stored.integration_id = p_integration_id AND stored.id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF stored_status <> 'leased' OR stored_token IS DISTINCT FROM p_claim_token
    OR stored_expiry <= pg_catalog.clock_timestamp() THEN
    RETURN 'stale';
  END IF;
  next_status := CASE WHEN p_outcome = 'unsupported' THEN 'quarantined'
    WHEN stored_attempts >= 5 THEN 'dead_letter' ELSE 'pending' END;
  UPDATE piggyvest_staging.inbox AS stored SET
    status = next_status, claim_token = NULL, lease_expires_at = NULL,
    available_at = CASE WHEN next_status = 'pending'
      THEN pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_retry_seconds)
      ELSE stored.available_at END,
    updated_at = pg_catalog.clock_timestamp()
    WHERE stored.id = p_inbox_id AND stored.integration_id = p_integration_id;
  RETURN next_status;
END $$;

REVOKE ALL ON SCHEMA piggyvest_staging FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_staging.integrations IS
  'Private staging account registry; disabled by default and no provisioning grants. Unique expected provider business/account identity is configuration only, not tenant/customer/wallet authority. Future authenticated intake must verify the documented envelope account against trusted configuration before enqueue.';
COMMENT ON FUNCTION piggyvest_staging.enqueue_inbox(uuid, text, bytea) IS
  'Enabled registered integration required (22023 otherwise). Opaque event ID 1..512 bytes, raw body 0..65536 bytes. Returns inbox_id and accepted|duplicate|conflict. Exact raw-byte replay deduplication, no timestamp replay detection or signature verification. Commit before acknowledgement; retry transaction on 40001.';
COMMENT ON FUNCTION piggyvest_staging.claim_inbox(uuid, integer, integer) IS
  'Enabled registry only; unknown/disabled returns empty. Batch 1..100, lease 1..300 seconds, five attempts including expired leases. Returns inbox_id,event ID,raw body,SHA256 fingerprint,token,attempts,expiry. Exhausted rows consume slots and become dead_letter. Every event must finish unsupported until a separately approved parser/mapping/reconciliation exists.';
COMMENT ON FUNCTION piggyvest_staging.finish_inbox(uuid, uuid, uuid, text, integer) IS
  'Quarantine-only completion: unsupported -> quarantined; retry -> pending or dead_letter at five attempts. Delay 0..3600 seconds (zero for unsupported). Unknown/disabled integration, missing row, expired or mismatched token -> stale. No processed outcome, financial effects, or tenant/wallet mapping.';

COMMIT;
