CREATE TABLE private.brilstash_candidate_approvals (
  installation_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  catalogue_revision bigint NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, id),
  UNIQUE (installation_id, candidate_id),
  FOREIGN KEY (installation_id, candidate_id)
    REFERENCES private.brilstash_generations(installation_id, id)
);

CREATE TABLE private.brilstash_fresh_installation_evidence (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_identity text NOT NULL,
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, id)
);

CREATE TABLE private.brilstash_first_activations (
  installation_id uuid PRIMARY KEY REFERENCES private.brilstash_installations(id),
  approval_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  activated_by uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id, approval_id) REFERENCES private.brilstash_candidate_approvals(installation_id, id),
  FOREIGN KEY (installation_id, evidence_id) REFERENCES private.brilstash_fresh_installation_evidence(installation_id, id),
  FOREIGN KEY (installation_id, generation_id) REFERENCES private.brilstash_generations(installation_id, id)
);

ALTER TABLE private.brilstash_candidate_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_fresh_installation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_first_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY brilstash_no_direct_access ON private.brilstash_candidate_approvals
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_fresh_installation_evidence
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_first_activations
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE private.brilstash_candidate_approvals, private.brilstash_fresh_installation_evidence,
  private.brilstash_first_activations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.brilstash_actor_is_operator(p_installation_id uuid, p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH actor AS (SELECT auth.uid() AS id)
  SELECT EXISTS (
    SELECT 1 FROM actor a
    WHERE a.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM private.brilstash_builder_entitlements e
        WHERE e.installation_id = p_installation_id AND e.user_id = a.id)
      AND (
        EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = a.id)
        OR public.check_staff_permission(a.id, p_merchant_id, 'integrations', 'manage')
      )
  );
$$;

CREATE FUNCTION private.brilstash_lock_operator(p_installation_id uuid)
RETURNS private.brilstash_installations
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  SELECT i.id, i.merchant_id, i.partner_identity, i.active_generation_id, i.activated_at,
    i.retired_at, i.admission, i.catalogue_revision, i.serving_revision, i.credential_revision
  INTO installation
  FROM private.brilstash_installations i
  WHERE i.id = p_installation_id AND i.retired_at IS NULL
    AND private.brilstash_actor_is_operator(i.id, i.merchant_id)
  FOR UPDATE;
  IF installation.id IS NULL OR NOT private.brilstash_actor_is_operator(installation.id, installation.merchant_id) THEN
    RAISE EXCEPTION 'BrilStash operator access denied' USING ERRCODE = '42501';
  END IF;
  RETURN installation;
END;
$$;

CREATE FUNCTION private.brilstash_clock()
RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT clock_timestamp()
$$;

CREATE FUNCTION private.brilstash_promotion_window_allows(p_window_date date, p_clock timestamptz)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT p_window_date = (p_clock AT TIME ZONE 'Africa/Lagos')::date
    AND (p_clock AT TIME ZONE 'Africa/Lagos')::time >= time '22:00'
    AND (p_clock AT TIME ZONE 'Africa/Lagos')::time < time '23:30'
$$;

CREATE FUNCTION public.inspect_brilstash_candidate(p_installation_id uuid, p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'candidateId', g.id, 'catalogueRevision', g.catalogue_revision::text,
    'payload', g.payload, 'payloadDigest', g.payload_digest, 'digestFormat', g.digest_format,
    'activeGenerationId', i.active_generation_id, 'activatedAt', i.activated_at,
    'servingRevision', i.serving_revision::text, 'credentialRevision', i.credential_revision::text,
    'admission', i.admission
  ) INTO result
  FROM private.brilstash_installations i
  JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = p_candidate_id
  WHERE i.id = p_installation_id AND private.brilstash_actor_is_operator(i.id, i.merchant_id);
  IF result IS NULL THEN
    RAISE EXCEPTION 'BrilStash candidate unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.approve_brilstash_candidate(
  p_installation_id uuid, p_candidate_id uuid, p_payload_digest text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE approval_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  INSERT INTO private.brilstash_candidate_approvals (
    installation_id, candidate_id, catalogue_revision, payload_digest, approved_by
  )
  SELECT g.installation_id, g.id, g.catalogue_revision, g.payload_digest, auth.uid()
  FROM private.brilstash_generations g
  WHERE g.installation_id = installation.id AND g.id = p_candidate_id
    AND g.payload_digest = p_payload_digest AND g.catalogue_revision = installation.catalogue_revision
  ON CONFLICT (installation_id, candidate_id) DO NOTHING
  RETURNING id INTO approval_id;
  IF approval_id IS NULL THEN
    SELECT a.id INTO approval_id FROM private.brilstash_candidate_approvals a
    WHERE a.installation_id = installation.id AND a.candidate_id = p_candidate_id
      AND a.payload_digest = p_payload_digest AND a.catalogue_revision = installation.catalogue_revision;
  END IF;
  IF approval_id IS NULL THEN
    RAISE EXCEPTION 'BrilStash candidate or digest does not match current catalogue' USING ERRCODE = '23514';
  END IF;
  RETURN approval_id;
END;
$$;

CREATE FUNCTION public.record_brilstash_fresh_installation(
  p_installation_id uuid, p_partner_identity text, p_evidence_reference text,
  p_scheduled_enabled boolean, p_manual_enabled boolean, p_pending_job_count integer,
  p_no_prior_import_or_stage boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE evidence_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_partner_identity IS DISTINCT FROM installation.partner_identity
    OR installation.activated_at IS NOT NULL OR installation.active_generation_id IS NOT NULL
    OR p_scheduled_enabled IS DISTINCT FROM false OR p_manual_enabled IS DISTINCT FROM false
    OR p_pending_job_count IS DISTINCT FROM 0 OR p_no_prior_import_or_stage IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'Fresh BrilStash installation evidence required' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.brilstash_fresh_installation_evidence (
    installation_id, partner_identity, evidence_reference, recorded_by
  ) VALUES (installation.id, installation.partner_identity, p_evidence_reference, auth.uid())
  RETURNING id INTO evidence_id;
  RETURN evidence_id;
END;
$$;

CREATE FUNCTION public.activate_first_brilstash_snapshot(
  p_installation_id uuid, p_candidate_id uuid, p_window_date date, p_evidence_id uuid, p_approval_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
DECLARE candidate jsonb;
DECLARE source_read_at timestamptz;
DECLARE current_rows jsonb;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  IF private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR installation.admission <> 'unactivated' OR installation.activated_at IS NOT NULL
    OR installation.active_generation_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM private.brilstash_first_activations a WHERE a.installation_id = installation.id)
  THEN
    RAISE EXCEPTION 'BrilStash first activation is unavailable' USING ERRCODE = '23514';
  END IF;

  SELECT g.payload, g.source_read_at INTO candidate, source_read_at
  FROM private.brilstash_generations g
  JOIN private.brilstash_candidate_approvals a ON a.installation_id = g.installation_id
    AND a.candidate_id = g.id AND a.payload_digest = g.payload_digest
    AND a.catalogue_revision = g.catalogue_revision
  JOIN private.brilstash_fresh_installation_evidence e ON e.installation_id = g.installation_id
    AND e.id = p_evidence_id AND e.partner_identity = installation.partner_identity
  WHERE g.installation_id = installation.id AND g.id = p_candidate_id AND a.id = p_approval_id
    AND g.catalogue_revision = installation.catalogue_revision
    AND g.expected_active_generation_id IS NULL
    AND private.brilstash_read_is_fresh(installation.id, g.source_read_at, current_clock, true);

  SELECT COALESCE(jsonb_agg(source.row), '[]'::jsonb) INTO current_rows
  FROM private.brilstash_source_rows(installation.id, installation.merchant_id) source(row);
  IF candidate IS NULL OR NOT private.brilstash_candidate_matches_sources(candidate, current_rows) THEN
    RAISE EXCEPTION 'BrilStash activation evidence or candidate is invalid' USING ERRCODE = '23514';
  END IF;
  current_clock := private.brilstash_clock();
  IF private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR NOT private.brilstash_read_is_fresh(installation.id, source_read_at, current_clock, true)
  THEN
    RAISE EXCEPTION 'BrilStash activation window or freshness ended' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.brilstash_first_activations (
    installation_id, approval_id, evidence_id, generation_id, activated_by, activated_at
  ) VALUES (installation.id, p_approval_id, p_evidence_id, p_candidate_id, auth.uid(), current_clock);
  UPDATE private.brilstash_installations SET active_generation_id = p_candidate_id,
    activated_at = current_clock, admission = 'open', serving_revision = serving_revision + 1
  WHERE id = installation.id;
  RETURN p_candidate_id;
END;
$$;

REVOKE ALL ON FUNCTION private.brilstash_actor_is_operator(uuid, uuid),
  private.brilstash_lock_operator(uuid), private.brilstash_clock(),
  private.brilstash_promotion_window_allows(date, timestamptz),
  public.inspect_brilstash_candidate(uuid, uuid), public.approve_brilstash_candidate(uuid, uuid, text),
  public.record_brilstash_fresh_installation(uuid, text, text, boolean, boolean, integer, boolean),
  public.activate_first_brilstash_snapshot(uuid, uuid, date, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.inspect_brilstash_candidate(uuid, uuid),
  public.approve_brilstash_candidate(uuid, uuid, text),
  public.record_brilstash_fresh_installation(uuid, text, text, boolean, boolean, integer, boolean),
  public.activate_first_brilstash_snapshot(uuid, uuid, date, uuid, uuid)
  TO authenticated;
