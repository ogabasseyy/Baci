CREATE TABLE private.brilstash_released_attempts (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  catalogue_revision bigint NOT NULL,
  serving_revision bigint NOT NULL,
  credential_revision bigint NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  configuration_revision text NOT NULL CHECK (char_length(btrim(configuration_revision)) BETWEEN 1 AND 256),
  run_id text NOT NULL CHECK (char_length(btrim(run_id)) BETWEEN 1 AND 256),
  attempt_id text NOT NULL CHECK (char_length(btrim(attempt_id)) BETWEEN 1 AND 256),
  staged_result_id text NOT NULL CHECK (char_length(btrim(staged_result_id)) BETWEEN 1 AND 256),
  verification_id uuid NOT NULL,
  application_deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'release_requested' CHECK (status IN (
    'release_requested', 'awaiting_application', 'partial_application', 'applied',
    'cancelled_without_application', 'discarded_without_application', 'partial_application_reconciled'
  )),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  withdrawal_required boolean NOT NULL DEFAULT false,
  disposition_reference text,
  disposition_recorded_by uuid,
  disposition_recorded_at timestamptz,
  resolved_at timestamptz,
  PRIMARY KEY (installation_id, id),
  UNIQUE (installation_id, run_id, attempt_id),
  FOREIGN KEY (installation_id, generation_id) REFERENCES private.brilstash_generations (installation_id, id),
  FOREIGN KEY (installation_id, credential_id) REFERENCES private.brilstash_credentials (installation_id, id),
  CHECK (application_deadline > requested_at),
  CHECK ((resolved_at IS NOT NULL) = (status IN (
    'applied', 'cancelled_without_application', 'discarded_without_application', 'partial_application_reconciled'
  )))
);

CREATE UNIQUE INDEX brilstash_one_unresolved_attempt_idx
  ON private.brilstash_released_attempts (installation_id) WHERE resolved_at IS NULL;
CREATE INDEX brilstash_released_attempts_generation_idx
  ON private.brilstash_released_attempts (installation_id, generation_id);
CREATE INDEX brilstash_released_attempts_credential_idx
  ON private.brilstash_released_attempts (installation_id, credential_id);

ALTER TABLE private.brilstash_released_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_released_attempts
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_released_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_brilstash_unresolved_attempt()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.admission = 'suspended' THEN
    UPDATE private.brilstash_released_attempts
    SET withdrawal_required = true
    WHERE installation_id = OLD.id AND resolved_at IS NULL AND NOT withdrawal_required;
  ELSIF NEW.active_generation_id IS DISTINCT FROM OLD.active_generation_id
    OR NEW.admission IS DISTINCT FROM OLD.admission THEN
    IF EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
      WHERE a.installation_id = OLD.id AND a.resolved_at IS NULL) THEN
      RAISE EXCEPTION 'BrilStash release attempt is unresolved' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_brilstash_unresolved_attempt
  BEFORE UPDATE OF admission, active_generation_id ON private.brilstash_installations
  FOR EACH ROW EXECUTE FUNCTION private.guard_brilstash_unresolved_attempt();

CREATE FUNCTION public.record_brilstash_release_request(p_installation_id uuid, p_request jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE candidate_id uuid;
DECLARE requested_credential_id uuid;
DECLARE current_clock timestamptz;
DECLARE deadline timestamptz;
DECLARE release_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  IF installation.admission <> 'open'
    OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request - ARRAY['generationId','credentialId','catalogueRevision','servingRevision',
      'credentialRevision','payloadDigest','configurationRevision','runId','attemptId',
      'stagedResultId','verificationId','applicationDeadline'] <> '{}'::jsonb
    OR p_request->>'catalogueRevision' IS DISTINCT FROM installation.catalogue_revision::text
    OR p_request->>'servingRevision' IS DISTINCT FROM installation.serving_revision::text
    OR p_request->>'credentialRevision' IS DISTINCT FROM installation.credential_revision::text
  THEN RAISE EXCEPTION 'BrilStash release verification is stale' USING ERRCODE = '23514'; END IF;

  candidate_id := (p_request->>'generationId')::uuid;
  requested_credential_id := (p_request->>'credentialId')::uuid;
  deadline := (p_request->>'applicationDeadline')::timestamptz;

  IF candidate_id IS DISTINCT FROM installation.active_generation_id
    OR deadline IS NULL OR NOT isfinite(deadline) OR deadline <= current_clock
    OR NOT private.brilstash_active_generation_is_eligible(installation.id, candidate_id)
    OR NOT EXISTS (
      SELECT 1 FROM private.brilstash_generations g
      WHERE g.installation_id = installation.id AND g.id = candidate_id
        AND g.payload_digest = p_request->>'payloadDigest'
        AND private.brilstash_read_is_fresh(installation.id, g.source_read_at, current_clock)
        AND g.source_read_at + interval '26 hours' > deadline
    )
    OR NOT EXISTS (
      SELECT 1 FROM private.brilstash_credentials c
      WHERE c.installation_id = installation.id AND c.id = requested_credential_id AND c.revoked_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at > current_clock)
    )
  THEN RAISE EXCEPTION 'BrilStash release verification is stale' USING ERRCODE = '23514'; END IF;

  SELECT a.id INTO release_id FROM private.brilstash_released_attempts a
  WHERE a.installation_id = installation.id AND a.run_id = p_request->>'runId'
    AND a.attempt_id = p_request->>'attemptId' AND a.status = 'release_requested'
    AND a.generation_id = candidate_id AND a.credential_id = requested_credential_id
    AND a.catalogue_revision = installation.catalogue_revision AND a.serving_revision = installation.serving_revision
    AND a.credential_revision = installation.credential_revision
    AND a.configuration_revision = p_request->>'configurationRevision'
    AND a.staged_result_id = p_request->>'stagedResultId'
    AND a.verification_id = (p_request->>'verificationId')::uuid
    AND a.application_deadline = deadline;
  IF release_id IS NOT NULL THEN RETURN release_id; END IF;

  IF EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
    WHERE a.installation_id = installation.id AND a.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'BrilStash release attempt is unresolved' USING ERRCODE = '23514';
  END IF;

  INSERT INTO private.brilstash_released_attempts (
    installation_id, generation_id, credential_id, catalogue_revision,
    serving_revision, credential_revision, payload_digest, configuration_revision,
    run_id, attempt_id, staged_result_id, verification_id, application_deadline, requested_by, requested_at
  ) VALUES (
    installation.id, candidate_id, requested_credential_id, installation.catalogue_revision,
    installation.serving_revision, installation.credential_revision, p_request->>'payloadDigest',
    p_request->>'configurationRevision', p_request->>'runId', p_request->>'attemptId',
    p_request->>'stagedResultId', (p_request->>'verificationId')::uuid, deadline, auth.uid(), current_clock
  ) RETURNING id INTO release_id;
  RETURN release_id;
END;
$$;

CREATE FUNCTION public.record_brilstash_attempt_disposition(
  p_installation_id uuid, p_release_id uuid, p_run_id text, p_attempt_id text,
  p_status text, p_evidence_reference text, p_catalogue_state_verified boolean, p_further_jobs_blocked boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
DECLARE is_terminal boolean;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  is_terminal := p_status IN ('applied', 'cancelled_without_application',
    'discarded_without_application', 'partial_application_reconciled');
  IF p_status IS NULL OR NOT (is_terminal OR p_status IN ('awaiting_application', 'partial_application'))
    OR p_evidence_reference IS NULL OR char_length(btrim(p_evidence_reference)) NOT BETWEEN 1 AND 1024
    OR (is_terminal AND (p_catalogue_state_verified IS DISTINCT FROM true OR p_further_jobs_blocked IS DISTINCT FROM true))
  THEN RAISE EXCEPTION 'BrilStash attempt disposition evidence is invalid' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_released_attempts a SET status = p_status,
    disposition_reference = p_evidence_reference, disposition_recorded_by = auth.uid(),
    disposition_recorded_at = current_clock, resolved_at = CASE WHEN is_terminal THEN current_clock END
  WHERE a.installation_id = installation.id AND a.id = p_release_id
    AND a.run_id = p_run_id AND a.attempt_id = p_attempt_id AND a.resolved_at IS NULL
    AND (a.status <> 'partial_application' OR p_status IN ('partial_application', 'partial_application_reconciled'))
    AND (p_status <> 'awaiting_application' OR a.status = 'release_requested')
    AND (a.status, a.disposition_reference) IS DISTINCT FROM (p_status, p_evidence_reference);
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
    WHERE a.installation_id = installation.id AND a.id = p_release_id
      AND a.run_id = p_run_id AND a.attempt_id = p_attempt_id AND a.status = p_status
      AND a.disposition_reference = p_evidence_reference
  ) THEN
    RAISE EXCEPTION 'BrilStash attempt disposition does not match current state' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.inspect_brilstash_releases(p_installation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.brilstash_installations i
    WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id)) THEN
    RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(item.result ORDER BY item.priority, item.requested_at DESC, item.id), '[]'::jsonb)
  INTO result FROM (
    SELECT jsonb_build_object(
      'releaseId', a.id, 'generationId', a.generation_id, 'configurationRevision', a.configuration_revision,
      'runId', a.run_id, 'attemptId', a.attempt_id, 'stagedResultId', a.staged_result_id,
      'verificationId', a.verification_id,
      'status', a.status, 'requestedAt', a.requested_at, 'resolvedAt', a.resolved_at,
      'applicationDeadline', a.application_deadline, 'withdrawalRequired', a.withdrawal_required,
      'overdue', a.resolved_at IS NULL AND a.application_deadline <= statement_timestamp(),
      'dispositionReference', a.disposition_reference
    ) AS result, CASE WHEN a.resolved_at IS NULL THEN 0 ELSE 1 END AS priority, a.requested_at, a.id
    FROM private.brilstash_released_attempts a
    WHERE a.installation_id = p_installation_id
    ORDER BY priority, a.requested_at DESC, a.id LIMIT 20
  ) item;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_brilstash_unresolved_attempt(),
  public.inspect_brilstash_releases(uuid),
  public.record_brilstash_release_request(uuid, jsonb),
  public.record_brilstash_attempt_disposition(uuid, uuid, text, text, text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_brilstash_releases(uuid),
  public.record_brilstash_release_request(uuid, jsonb),
  public.record_brilstash_attempt_disposition(uuid, uuid, text, text, text, text, boolean, boolean)
  TO authenticated;
