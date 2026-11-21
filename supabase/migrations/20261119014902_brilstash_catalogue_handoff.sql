CREATE TABLE private.brilstash_handoff_probes (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  state_claim jsonb NOT NULL,
  feed_url text NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, id)
);

CREATE TABLE private.brilstash_saved_connections (
  installation_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  probe_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  connection_claim jsonb NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, id),
  FOREIGN KEY (installation_id, probe_id) REFERENCES private.brilstash_handoff_probes(installation_id, id)
);

ALTER TABLE private.brilstash_released_attempts ADD CONSTRAINT brilstash_release_verified_connection
  FOREIGN KEY (installation_id, verification_id) REFERENCES private.brilstash_saved_connections(installation_id, id);
CREATE INDEX brilstash_release_connection_idx ON private.brilstash_released_attempts(installation_id, verification_id);
CREATE INDEX brilstash_saved_connection_probe_idx ON private.brilstash_saved_connections(installation_id, probe_id);

ALTER TABLE private.brilstash_handoff_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_saved_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_handoff_probes
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_saved_connections
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_handoff_probes, private.brilstash_saved_connections
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_brilstash_handoff_probe(
  p_installation_id uuid, p_state jsonb, p_request_id uuid, p_feed_url text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE probe_id uuid;
BEGIN
  PERFORM private.brilstash_lock_operator(p_installation_id);
  IF p_state IS DISTINCT FROM public.inspect_brilstash_probe_state(p_installation_id)
    OR p_request_id IS NULL
    OR p_feed_url IS NULL OR char_length(p_feed_url) > 400
    OR p_feed_url !~ '^https://[a-z0-9][a-z0-9.-]*/partners/yield/brilpay/products\?page=1&limit=100&min_price=0$'
    OR EXISTS (SELECT 1 FROM private.brilstash_saved_connections c WHERE c.request_id = p_request_id)
  THEN RAISE EXCEPTION 'BrilStash probe does not match current serving state' USING ERRCODE = '23514'; END IF;

  INSERT INTO private.brilstash_handoff_probes(installation_id, request_id, state_claim, feed_url, recorded_by)
  VALUES (p_installation_id, p_request_id, p_state, p_feed_url, auth.uid())
  ON CONFLICT (request_id) DO NOTHING RETURNING id INTO probe_id;
  IF probe_id IS NULL THEN
    SELECT p.id INTO probe_id FROM private.brilstash_handoff_probes p
    WHERE p.installation_id = p_installation_id AND p.request_id = p_request_id
      AND p.state_claim = p_state AND p.feed_url = p_feed_url;
  END IF;
  IF probe_id IS NULL THEN
    RAISE EXCEPTION 'BrilStash probe request already recorded with different details' USING ERRCODE = '23514';
  END IF;
  RETURN probe_id;
END;
$$;

CREATE FUNCTION private.brilstash_current_handoff_probe(p_installation_id uuid, p_probe_id uuid)
RETURNS private.brilstash_handoff_probes
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE probe private.brilstash_handoff_probes;
BEGIN
  SELECT p.* INTO probe FROM private.brilstash_handoff_probes p
  WHERE p.installation_id = p_installation_id AND p.id = p_probe_id;
  IF NOT FOUND OR probe.state_claim IS DISTINCT FROM public.inspect_brilstash_probe_state(p_installation_id)
  THEN RAISE EXCEPTION 'BrilStash handoff requires a fresh probe' USING ERRCODE = '23514'; END IF;
  RETURN probe;
END;
$$;

-- The partner request and proof must come from the saved configuration check or held job.
-- The authenticated operator attests the partner origin and records where it was verified.
CREATE FUNCTION public.record_brilstash_saved_connection(
  p_installation_id uuid, p_probe_id uuid, p_connection jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE probe private.brilstash_handoff_probes;
DECLARE partner_request_id uuid;
DECLARE verification_id uuid;
DECLARE expected_proof text;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  probe := private.brilstash_current_handoff_probe(installation.id, p_probe_id);
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_drain_policies d WHERE d.installation_id = installation.id
  ) OR jsonb_typeof(p_connection) IS DISTINCT FROM 'object'
    OR p_connection - ARRAY['partnerIdentity','url','configurationRevision','requestId','pageProof',
      'evidenceReference','importsDisabled','mode','runId','attemptId','stagedResultId'] <> '{}'::jsonb
    OR p_connection->>'partnerIdentity' IS DISTINCT FROM installation.partner_identity
    OR p_connection->>'url' IS DISTINCT FROM probe.feed_url
    OR (p_connection->'importsDisabled') IS DISTINCT FROM 'true'::jsonb
    OR COALESCE(p_connection->>'mode', '') NOT IN ('saved', 'held')
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY['configurationRevision','evidenceReference','requestId','pageProof']) AS fields(field)
      WHERE jsonb_typeof(p_connection->field) IS DISTINCT FROM 'string'
        OR COALESCE(char_length(btrim(p_connection->>field)), 0) NOT BETWEEN 1 AND
          CASE WHEN field = 'evidenceReference' THEN 1024 ELSE 256 END
    )
    OR (p_connection->>'mode' = 'saved' AND p_connection ?| ARRAY['runId','attemptId','stagedResultId'])
    OR (p_connection->>'mode' = 'held' AND EXISTS (
      SELECT 1 FROM unnest(ARRAY['runId','attemptId','stagedResultId']) AS fields(field)
      WHERE jsonb_typeof(p_connection->field) IS DISTINCT FROM 'string'
        OR COALESCE(char_length(btrim(p_connection->>field)), 0) NOT BETWEEN 1 AND 256
    ))
  THEN RAISE EXCEPTION 'BrilStash saved connection does not match the handoff' USING ERRCODE = '23514'; END IF;

  partner_request_id := (p_connection->>'requestId')::uuid;
  expected_proof := encode(sha256(convert_to(private.brilstash_canonical_json(jsonb_build_array(
    'brilstash-page-v1', partner_request_id, probe.state_claim->>'generationId',
    probe.state_claim->>'credentialId', probe.state_claim->>'payloadDigest'
  )), 'UTF8')), 'hex');
  IF p_connection->>'pageProof' IS DISTINCT FROM expected_proof
    OR EXISTS (SELECT 1 FROM private.brilstash_handoff_probes p WHERE p.request_id = partner_request_id)
  THEN RAISE EXCEPTION 'BrilStash partner request did not prove the saved connection' USING ERRCODE = '23514'; END IF;

  INSERT INTO private.brilstash_saved_connections(installation_id, probe_id, request_id, connection_claim, recorded_by)
  VALUES (installation.id, probe.id, partner_request_id, p_connection, auth.uid())
  ON CONFLICT (request_id) DO NOTHING RETURNING id INTO verification_id;
  IF verification_id IS NULL THEN
    SELECT c.id INTO verification_id FROM private.brilstash_saved_connections c
    WHERE c.installation_id = installation.id AND c.probe_id = probe.id
      AND c.request_id = partner_request_id AND c.connection_claim = p_connection;
  END IF;
  IF verification_id IS NULL THEN
    RAISE EXCEPTION 'BrilStash partner request already recorded with different details' USING ERRCODE = '23514';
  END IF;
  RETURN verification_id;
END;
$$;

CREATE FUNCTION private.brilstash_require_verified_release()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_saved_connections c
    JOIN private.brilstash_handoff_probes p ON p.installation_id = c.installation_id AND p.id = c.probe_id
    WHERE c.installation_id = NEW.installation_id AND c.id = NEW.verification_id
      AND c.connection_claim @> jsonb_build_object(
        'mode', 'held', 'configurationRevision', NEW.configuration_revision,
        'runId', NEW.run_id, 'attemptId', NEW.attempt_id, 'stagedResultId', NEW.staged_result_id
      )
      AND p.state_claim @> jsonb_build_object(
        'generationId', NEW.generation_id, 'credentialId', NEW.credential_id,
        'catalogueRevision', NEW.catalogue_revision::text, 'servingRevision', NEW.serving_revision::text,
        'credentialRevision', NEW.credential_revision::text, 'payloadDigest', NEW.payload_digest
      )
  ) THEN RAISE EXCEPTION 'BrilStash exact held result was not verified' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER brilstash_require_verified_release
  BEFORE INSERT ON private.brilstash_released_attempts
  FOR EACH ROW EXECUTE FUNCTION private.brilstash_require_verified_release();

-- This is a local preflight. Enablement and selective release still need the
-- exact configuration or attempt precondition on the BrilStash operation.
CREATE FUNCTION public.check_brilstash_handoff(
  p_installation_id uuid, p_probe_id uuid, p_verification_id uuid DEFAULT NULL, p_release_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE probe private.brilstash_handoff_probes;
DECLARE verification jsonb;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  probe := private.brilstash_current_handoff_probe(installation.id, p_probe_id);
  IF p_verification_id IS NOT NULL THEN
    SELECT c.connection_claim INTO verification FROM private.brilstash_saved_connections c
    WHERE c.installation_id = installation.id AND c.probe_id = probe.id AND c.id = p_verification_id;
    IF NOT FOUND OR (verification->>'mode' = 'held') IS DISTINCT FROM (p_release_id IS NOT NULL) THEN
      RAISE EXCEPTION 'BrilStash verification does not authorize this handoff action' USING ERRCODE = '23514';
    END IF;
  ELSIF p_release_id IS NOT NULL THEN
    RAISE EXCEPTION 'BrilStash release requires saved-connection verification' USING ERRCODE = '23514';
  END IF;

  IF p_release_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
      WHERE a.installation_id = installation.id AND a.resolved_at IS NULL) THEN
      RAISE EXCEPTION 'BrilStash release attempt is unresolved' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
    WHERE a.installation_id = installation.id AND a.id = p_release_id AND a.verification_id = p_verification_id
      AND a.status = 'release_requested' AND NOT a.withdrawal_required
      AND a.application_deadline > private.brilstash_clock()) THEN
    RAISE EXCEPTION 'BrilStash release is no longer eligible' USING ERRCODE = '23514';
  END IF;

  RETURN probe.state_claim || jsonb_build_object(
    'probeId', probe.id, 'partnerIdentity', installation.partner_identity, 'feedUrl', probe.feed_url,
    'verificationId', p_verification_id, 'releaseId', p_release_id
  ) || COALESCE(verification - ARRAY['evidenceReference','pageProof','url'], '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.record_brilstash_handoff_probe(uuid, jsonb, uuid, text),
  private.brilstash_current_handoff_probe(uuid, uuid),
  public.record_brilstash_saved_connection(uuid, uuid, jsonb),
  private.brilstash_require_verified_release(),
  public.check_brilstash_handoff(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_brilstash_handoff_probe(uuid, jsonb, uuid, text),
  public.record_brilstash_saved_connection(uuid, uuid, jsonb),
  public.check_brilstash_handoff(uuid, uuid, uuid, uuid) TO authenticated;
