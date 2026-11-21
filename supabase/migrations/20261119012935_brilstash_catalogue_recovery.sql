CREATE TABLE private.brilstash_recoveries (
  installation_id uuid NOT NULL,
  suspension_id uuid NOT NULL,
  replacement_generation_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  resumed_by uuid NOT NULL,
  resumed_at timestamptz NOT NULL,
  partner_evidence_reference text NOT NULL CHECK (
    char_length(btrim(partner_evidence_reference)) BETWEEN 1 AND 1024
  ),
  withdrawn_external_ids text[] NOT NULL CHECK (cardinality(withdrawn_external_ids) <= 7),
  PRIMARY KEY (installation_id, suspension_id),
  FOREIGN KEY (installation_id, suspension_id) REFERENCES private.brilstash_suspensions(installation_id, id),
  FOREIGN KEY (installation_id, approval_id) REFERENCES private.brilstash_candidate_approvals(installation_id, id),
  FOREIGN KEY (installation_id, replacement_generation_id) REFERENCES private.brilstash_generations(installation_id, id)
);
CREATE INDEX brilstash_recoveries_replacement_idx
  ON private.brilstash_recoveries(installation_id, replacement_generation_id);
CREATE INDEX brilstash_recoveries_approval_idx
  ON private.brilstash_recoveries(installation_id, approval_id);
ALTER TABLE private.brilstash_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_recoveries
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_recoveries FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE private.brilstash_suspensions ADD COLUMN withdrawn_external_ids text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(withdrawn_external_ids) <= 7);

CREATE FUNCTION public.suspend_brilstash_listings(
  p_installation_id uuid, p_reason text, p_external_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE suspension_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_external_ids IS NULL OR cardinality(p_external_ids) NOT BETWEEN 1 AND 7
    OR array_position(p_external_ids, NULL) IS NOT NULL
    OR cardinality(p_external_ids) <> (SELECT count(DISTINCT target.external_id) FROM unnest(p_external_ids) target(external_id))
    OR EXISTS (
      SELECT 1 FROM unnest(p_external_ids) target(external_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM private.brilstash_generations g
        CROSS JOIN LATERAL jsonb_array_elements(g.payload) product
        WHERE g.installation_id = installation.id AND g.id = installation.active_generation_id
          AND product->>'external_id' = target.external_id
      )
    )
  THEN RAISE EXCEPTION 'BrilStash withdrawal targets do not match the active generation' USING ERRCODE = '23514'; END IF;

  suspension_id := public.suspend_brilstash_installation(installation.id, p_reason);
  UPDATE private.brilstash_suspensions SET withdrawn_external_ids = p_external_ids
  WHERE installation_id = installation.id AND id = suspension_id;
  RETURN suspension_id;
END;
$$;

CREATE FUNCTION public.abort_brilstash_drain(p_installation_id uuid, p_closure_revision bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
DECLARE window_date date;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  window_date := (current_clock AT TIME ZONE 'Africa/Lagos')::date;
  IF installation.admission <> 'closed'
    OR installation.serving_revision IS DISTINCT FROM p_closure_revision
  THEN RAISE EXCEPTION 'BrilStash closure cannot be aborted' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_drains d SET outcome = 'aborted', completed_at = current_clock
  FROM private.brilstash_generations g
  WHERE d.installation_id = installation.id AND d.closure_revision = p_closure_revision
    AND d.old_generation_id = installation.active_generation_id AND d.outcome IS NULL
    AND g.installation_id = d.installation_id AND g.id = d.old_generation_id
    AND g.source_read_at + interval '26 hours' >
      GREATEST(current_clock, private.brilstash_scheduled_pull_end(window_date, d.partner_drain_seconds));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BrilStash prior generation is no longer fresh' USING ERRCODE = '23514';
  END IF;

  UPDATE private.brilstash_installations
    SET admission = 'open', serving_revision = serving_revision + 1
    WHERE id = installation.id;
  -- Reuse the complete serving gate. Failure rolls back the temporary open state.
  IF NOT private.brilstash_active_generation_is_eligible(installation.id, installation.active_generation_id) THEN
    RAISE EXCEPTION 'BrilStash prior generation is no longer eligible' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.resume_brilstash_installation(
  p_installation_id uuid, p_suspension_id uuid, p_candidate_id uuid, p_approval_id uuid,
  p_window_date date, p_partner_evidence_reference text, p_off_sale_verified boolean,
  p_prior_jobs_disposed boolean, p_withdrawn_external_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE latest_suspension private.brilstash_suspensions;
DECLARE current_clock timestamptz;
DECLARE policy private.brilstash_drain_policies;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  IF installation.admission <> 'suspended' OR installation.activated_at IS NULL
    OR p_off_sale_verified IS DISTINCT FROM true OR p_prior_jobs_disposed IS DISTINCT FROM true
    OR p_withdrawn_external_ids IS NULL OR cardinality(p_withdrawn_external_ids) > 7
    OR array_position(p_withdrawn_external_ids, NULL) IS NOT NULL
    OR private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'BrilStash recovery prerequisites not met' USING ERRCODE = '23514'; END IF;

  SELECT s.installation_id, s.id, s.prior_generation_id, s.catalogue_revision, s.suspended_by,
    s.suspended_at, s.reason, s.withdrawn_external_ids INTO latest_suspension
  FROM private.brilstash_suspensions s
  WHERE s.installation_id = installation.id ORDER BY s.catalogue_revision DESC LIMIT 1;

  SELECT d.installation_id, d.partner_drain_seconds, d.promotion_allowance_seconds,
    d.protected_until, d.evidence_reference INTO policy
  FROM private.brilstash_drain_policies d WHERE d.installation_id = installation.id;

  IF latest_suspension.id IS NULL OR latest_suspension.id IS DISTINCT FROM p_suspension_id
    OR policy.installation_id IS NULL OR current_clock <= policy.protected_until
    OR current_clock + make_interval(secs => policy.promotion_allowance_seconds)
        > ((p_window_date + time '23:30') AT TIME ZONE 'Africa/Lagos')
    OR NOT private.brilstash_replacement_is_valid(installation.id, p_candidate_id,
      private.brilstash_scheduled_pull_end(p_window_date, policy.partner_drain_seconds), current_clock)
    OR EXISTS (SELECT 1 FROM private.brilstash_released_attempts a
      WHERE a.installation_id = installation.id AND a.resolved_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM private.brilstash_suspensions pending
      WHERE pending.installation_id = installation.id
        AND pending.catalogue_revision > COALESCE((
          SELECT max(resolved.catalogue_revision)
          FROM private.brilstash_recoveries recovery
          JOIN private.brilstash_suspensions resolved ON resolved.installation_id = recovery.installation_id
            AND resolved.id = recovery.suspension_id
          WHERE recovery.installation_id = installation.id
        ), 0)
        AND NOT (p_withdrawn_external_ids @> pending.withdrawn_external_ids)
    )
    OR NOT EXISTS (
      SELECT 1 FROM private.brilstash_generations g
      JOIN private.brilstash_candidate_approvals a ON a.installation_id = g.installation_id
        AND a.candidate_id = g.id AND a.catalogue_revision = g.catalogue_revision
        AND a.payload_digest = g.payload_digest
      WHERE g.installation_id = installation.id AND g.id = p_candidate_id AND a.id = p_approval_id
        AND g.source_read_at >= latest_suspension.suspended_at
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g.payload) row
          WHERE row->>'external_id' = ANY(p_withdrawn_external_ids))
    )
  THEN RAISE EXCEPTION 'BrilStash recovery generation or evidence is invalid' USING ERRCODE = '23514'; END IF;

  current_clock := private.brilstash_clock();
  IF private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR current_clock + make_interval(secs => policy.promotion_allowance_seconds)
        > ((p_window_date + time '23:30') AT TIME ZONE 'Africa/Lagos')
  THEN
    RAISE EXCEPTION 'BrilStash recovery window ended' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.brilstash_recoveries (
    installation_id, suspension_id, replacement_generation_id, approval_id, resumed_by,
    resumed_at, partner_evidence_reference, withdrawn_external_ids
  ) VALUES (
    installation.id, p_suspension_id, p_candidate_id, p_approval_id, auth.uid(), current_clock,
    p_partner_evidence_reference, p_withdrawn_external_ids
  );

  UPDATE private.brilstash_drains SET outcome = 'aborted', completed_at = current_clock
    WHERE installation_id = installation.id AND outcome IS NULL;
  UPDATE private.brilstash_installations
    SET admission = 'open', active_generation_id = p_candidate_id, serving_revision = serving_revision + 1
    WHERE id = installation.id;
  RETURN p_candidate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.suspend_brilstash_listings(uuid, text, text[]),
  public.abort_brilstash_drain(uuid, bigint),
  public.resume_brilstash_installation(uuid, uuid, uuid, uuid, date, text, boolean, boolean, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_brilstash_listings(uuid, text, text[]),
  public.abort_brilstash_drain(uuid, bigint),
  public.resume_brilstash_installation(uuid, uuid, uuid, uuid, date, text, boolean, boolean, text[])
  TO authenticated;
