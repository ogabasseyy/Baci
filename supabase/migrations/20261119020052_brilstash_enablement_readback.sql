CREATE TABLE private.brilstash_enablement_readbacks (
  installation_id uuid NOT NULL,
  id uuid NOT NULL,
  verification_id uuid NOT NULL,
  observed_revision text NOT NULL CHECK (char_length(btrim(observed_revision)) BETWEEN 1 AND 256),
  scheduled_enabled boolean NOT NULL,
  manual_enabled boolean NOT NULL,
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, id),
  FOREIGN KEY (installation_id, verification_id)
    REFERENCES private.brilstash_saved_connections(installation_id, id)
);
CREATE INDEX brilstash_enablement_readback_connection_idx
  ON private.brilstash_enablement_readbacks(installation_id, verification_id);
CREATE INDEX brilstash_enablement_readback_recent_idx
  ON private.brilstash_enablement_readbacks(installation_id, recorded_at DESC, id);

ALTER TABLE private.brilstash_enablement_readbacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_enablement_readbacks
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_enablement_readbacks FROM PUBLIC, anon, authenticated, service_role;

-- Preserve what was observed even if serving was suspended or the partner
-- changed configuration while confirming the enablement request.
CREATE FUNCTION public.record_brilstash_enablement_readback(
  p_installation_id uuid, p_verification_id uuid, p_readback_id uuid, p_observed_revision text,
  p_scheduled_enabled boolean, p_manual_enabled boolean, p_evidence_reference text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.brilstash_installations i
    WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id)
  ) THEN RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501'; END IF;

  IF NOT EXISTS (SELECT 1 FROM private.brilstash_saved_connections c
    WHERE c.installation_id = p_installation_id AND c.id = p_verification_id
      AND c.connection_claim->>'mode' = 'saved'
  ) OR p_readback_id IS NULL OR p_scheduled_enabled IS NULL OR p_manual_enabled IS NULL
    OR COALESCE(char_length(btrim(p_observed_revision)), 0) NOT BETWEEN 1 AND 256
    OR COALESCE(char_length(btrim(p_evidence_reference)), 0) NOT BETWEEN 1 AND 1024
  THEN RAISE EXCEPTION 'BrilStash enablement readback is invalid' USING ERRCODE = '23514'; END IF;

  INSERT INTO private.brilstash_enablement_readbacks (
    installation_id, id, verification_id, observed_revision, scheduled_enabled, manual_enabled,
    evidence_reference, recorded_by
  ) VALUES (
    p_installation_id, p_readback_id, p_verification_id, p_observed_revision, p_scheduled_enabled,
    p_manual_enabled, p_evidence_reference, auth.uid()
  ) ON CONFLICT (installation_id, id) DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM private.brilstash_enablement_readbacks r
    WHERE r.installation_id = p_installation_id AND r.id = p_readback_id
      AND r.verification_id = p_verification_id AND r.observed_revision = p_observed_revision
      AND r.scheduled_enabled = p_scheduled_enabled AND r.manual_enabled = p_manual_enabled
      AND r.evidence_reference = p_evidence_reference
  ) THEN RAISE EXCEPTION 'BrilStash readback ID conflicts with a recorded observation' USING ERRCODE = '23514'; END IF;
  RETURN p_readback_id;
END;
$$;

CREATE FUNCTION public.inspect_brilstash_enablement(p_installation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.brilstash_installations i
    WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id)
  ) THEN RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(jsonb_agg(item.evidence ORDER BY item.recorded_at DESC, item.id), '[]'::jsonb)
  INTO result FROM (
    SELECT r.id, r.recorded_at, jsonb_build_object(
      'readbackId', r.id, 'verificationId', r.verification_id, 'observedConfigurationRevision', r.observed_revision,
      'verifiedConfigurationRevision', c.connection_claim->>'configurationRevision',
      'matchesVerifiedRevision', r.observed_revision = c.connection_claim->>'configurationRevision',
      'scheduledEnabled', r.scheduled_enabled, 'manualEnabled', r.manual_enabled,
      'evidenceReference', r.evidence_reference, 'recordedAt', r.recorded_at, 'recordedBy', r.recorded_by
    ) AS evidence
    FROM private.brilstash_enablement_readbacks r
    JOIN private.brilstash_saved_connections c ON c.installation_id = r.installation_id AND c.id = r.verification_id
    WHERE r.installation_id = p_installation_id
    ORDER BY r.recorded_at DESC, r.id LIMIT 20
  ) item;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_brilstash_enablement_readback(uuid, uuid, uuid, text, boolean, boolean, text),
  public.inspect_brilstash_enablement(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_brilstash_enablement_readback(uuid, uuid, uuid, text, boolean, boolean, text),
  public.inspect_brilstash_enablement(uuid)
  TO authenticated;
