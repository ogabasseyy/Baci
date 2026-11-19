-- Drain-mode promotion is disabled until an operator records a qualified policy.
CREATE TABLE private.brilstash_drain_policies (
  installation_id uuid PRIMARY KEY REFERENCES private.brilstash_installations(id),
  partner_drain_seconds integer NOT NULL CHECK (partner_drain_seconds BETWEEN 1 AND 86400),
  promotion_allowance_seconds integer NOT NULL CHECK (promotion_allowance_seconds BETWEEN 1 AND 3600),
  protected_until timestamptz,
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024)
);

CREATE TABLE private.brilstash_drains (
  installation_id uuid NOT NULL REFERENCES private.brilstash_installations(id),
  closure_revision bigint NOT NULL CHECK (closure_revision > 0),
  old_generation_id uuid NOT NULL,
  opening_candidate_id uuid NOT NULL,
  closed_at timestamptz NOT NULL,
  closed_by uuid NOT NULL,
  partner_drain_seconds integer NOT NULL,
  promotion_allowance_seconds integer NOT NULL,
  evidence_disposition text CHECK (evidence_disposition IN ('committed', 'discarded', 'expired')),
  evidence_reference text CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 1024),
  evidence_recorded_at timestamptz,
  evidence_recorded_by uuid,
  outcome text CHECK (outcome IN ('promoted', 'aborted')),
  completed_at timestamptz,
  closure_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  closure_observed_at timestamptz,
  PRIMARY KEY (installation_id, closure_revision),
  FOREIGN KEY (installation_id, old_generation_id)
    REFERENCES private.brilstash_generations(installation_id, id),
  FOREIGN KEY (installation_id, opening_candidate_id)
    REFERENCES private.brilstash_generations(installation_id, id)
);

CREATE UNIQUE INDEX brilstash_one_open_drain_idx
  ON private.brilstash_drains(installation_id) WHERE outcome IS NULL;
CREATE INDEX brilstash_drains_old_generation_idx
  ON private.brilstash_drains(installation_id, old_generation_id);
CREATE INDEX brilstash_drains_opening_candidate_idx
  ON private.brilstash_drains(installation_id, opening_candidate_id);

ALTER TABLE private.brilstash_drain_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brilstash_drains ENABLE ROW LEVEL SECURITY;
CREATE POLICY brilstash_no_direct_access ON private.brilstash_drain_policies
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY brilstash_no_direct_access ON private.brilstash_drains
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.brilstash_drain_policies, private.brilstash_drains
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.brilstash_scheduled_pull_end(p_window_date date, p_drain_seconds integer)
RETURNS timestamptz
LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT ((p_window_date + time '23:59') AT TIME ZONE 'Africa/Lagos') +
    make_interval(secs => p_drain_seconds + 10)
$$;

CREATE FUNCTION private.brilstash_read_is_fresh(
  p_installation_id uuid, p_read_at timestamptz, p_now timestamptz, p_include_upcoming boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH clock_context AS (
    SELECT (p_now AT TIME ZONE 'Africa/Lagos')::date AS lagos_date
  )
  SELECT COALESCE(
    p_read_at <= p_now AND p_read_at + interval '26 hours' > GREATEST(
      p_now + interval '10 seconds',
      private.brilstash_scheduled_pull_end(c.lagos_date - 1, d.partner_drain_seconds),
      CASE WHEN p_include_upcoming OR p_now >= ((c.lagos_date + time '23:30') AT TIME ZONE 'Africa/Lagos')
        THEN private.brilstash_scheduled_pull_end(c.lagos_date, d.partner_drain_seconds)
      END,
      d.protected_until
    ),
    false
  )
  FROM clock_context c
  LEFT JOIN private.brilstash_drain_policies d ON d.installation_id = p_installation_id
$$;
REVOKE ALL ON FUNCTION private.brilstash_read_is_fresh(uuid, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.brilstash_read_is_fresh(uuid, timestamptz, timestamptz, boolean)
  TO baci_brilstash_reader;

CREATE FUNCTION private.brilstash_replacement_is_valid(
  p_installation_id uuid, p_candidate_id uuid, p_fresh_through timestamptz, p_now timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.brilstash_installations i
    JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = p_candidate_id
    JOIN private.brilstash_candidate_approvals a ON a.installation_id = g.installation_id
      AND a.candidate_id = g.id AND a.catalogue_revision = g.catalogue_revision
      AND a.payload_digest = g.payload_digest
    WHERE i.id = p_installation_id
      AND g.id IS DISTINCT FROM i.active_generation_id
      AND g.expected_active_generation_id IS NOT DISTINCT FROM i.active_generation_id
      AND g.catalogue_revision = i.catalogue_revision
      AND g.source_read_at <= p_now
      AND g.source_read_at + interval '26 hours' > p_fresh_through
      AND jsonb_array_length(g.source_manifest) = jsonb_array_length(g.payload)
      AND jsonb_array_length(g.payload) > 0
      AND private.brilstash_candidate_matches_sources(g.payload, COALESCE((
        SELECT jsonb_agg(source.row)
        FROM private.brilstash_source_rows(i.id, i.merchant_id) source(row)
      ), '[]'::jsonb))
  )
$$;

CREATE FUNCTION public.close_brilstash_admission(
  p_installation_id uuid, p_candidate_id uuid, p_window_date date
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE policy private.brilstash_drain_policies;
DECLARE current_clock timestamptz;
DECLARE latest_close timestamptz;
DECLARE revision bigint;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  SELECT d.installation_id, d.partner_drain_seconds, d.promotion_allowance_seconds,
    d.protected_until, d.evidence_reference INTO policy
  FROM private.brilstash_drain_policies d WHERE d.installation_id = installation.id;
  current_clock := private.brilstash_clock();
  latest_close := ((p_window_date + time '23:30') AT TIME ZONE 'Africa/Lagos') -
    make_interval(secs => 10 + policy.partner_drain_seconds + policy.promotion_allowance_seconds);
  IF installation.admission <> 'open' OR policy.installation_id IS NULL
    OR private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR current_clock > latest_close OR current_clock <= policy.protected_until
    OR NOT private.brilstash_replacement_is_valid(installation.id, p_candidate_id,
      private.brilstash_scheduled_pull_end(p_window_date, policy.partner_drain_seconds), current_clock)
  THEN RAISE EXCEPTION 'BrilStash drain cannot begin' USING ERRCODE = '23514'; END IF;
  current_clock := private.brilstash_clock();
  IF current_clock > latest_close THEN
    RAISE EXCEPTION 'BrilStash closure window ended' USING ERRCODE = '23514';
  END IF;

  revision := installation.serving_revision + 1;
  INSERT INTO private.brilstash_drains (
    installation_id, closure_revision, old_generation_id, opening_candidate_id,
    closed_at, closed_by, partner_drain_seconds, promotion_allowance_seconds
  ) VALUES (
    installation.id, revision, installation.active_generation_id, p_candidate_id,
    current_clock, auth.uid(), policy.partner_drain_seconds, policy.promotion_allowance_seconds
  );
  UPDATE private.brilstash_installations SET admission = 'closed', serving_revision = revision
    WHERE id = installation.id;
  RETURN revision;
END;
$$;

-- A second transaction must observe the closure before its response-drain
-- timer can begin. Reads that saw the old pointer before commit are in scope.
CREATE FUNCTION public.observe_brilstash_closure(p_installation_id uuid, p_closure_revision bigint)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE observed_at timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF installation.admission <> 'closed' OR p_closure_revision IS DISTINCT FROM installation.serving_revision
  THEN RAISE EXCEPTION 'BrilStash closure is no longer current' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_drains d
  SET closure_observed_at = COALESCE(d.closure_observed_at, private.brilstash_clock())
  WHERE d.installation_id = installation.id AND d.closure_revision = p_closure_revision
    AND d.old_generation_id = installation.active_generation_id AND d.outcome IS NULL
    AND d.closure_xid <> pg_current_xact_id()
  RETURNING d.closure_observed_at INTO observed_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'BrilStash closure is not committed' USING ERRCODE = '23514'; END IF;
  RETURN observed_at;
END;
$$;

CREATE FUNCTION public.record_brilstash_drain_evidence(
  p_installation_id uuid, p_closure_revision bigint, p_disposition text, p_evidence_reference text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  current_clock := private.brilstash_clock();
  IF installation.admission <> 'closed' OR p_closure_revision IS DISTINCT FROM installation.serving_revision
    OR p_disposition IS NULL OR p_disposition NOT IN ('committed', 'discarded', 'expired')
    OR p_evidence_reference IS NULL OR char_length(btrim(p_evidence_reference)) NOT BETWEEN 1 AND 1024
  THEN RAISE EXCEPTION 'BrilStash drain evidence does not match the closure' USING ERRCODE = '23514'; END IF;

  UPDATE private.brilstash_drains SET evidence_disposition = p_disposition,
    evidence_reference = p_evidence_reference, evidence_recorded_at = current_clock,
    evidence_recorded_by = auth.uid()
  WHERE installation_id = installation.id AND closure_revision = p_closure_revision
    AND old_generation_id = installation.active_generation_id AND outcome IS NULL
    AND evidence_recorded_at IS NULL
    AND current_clock >= closure_observed_at + make_interval(secs => 10 +
      CASE WHEN p_disposition = 'expired' THEN partner_drain_seconds ELSE 0 END);
  IF NOT FOUND THEN RAISE EXCEPTION 'BrilStash drain evidence cannot be recorded' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE FUNCTION public.promote_brilstash_snapshot(
  p_installation_id uuid, p_candidate_id uuid, p_window_date date, p_closure_revision bigint
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE drain private.brilstash_drains;
DECLARE current_clock timestamptz;
DECLARE finish_by timestamptz;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  SELECT d.installation_id, d.closure_revision, d.old_generation_id, d.opening_candidate_id,
    d.closed_at, d.closed_by, d.partner_drain_seconds, d.promotion_allowance_seconds,
    d.evidence_disposition, d.evidence_reference, d.evidence_recorded_at, d.evidence_recorded_by,
    d.outcome, d.completed_at INTO drain
  FROM private.brilstash_drains d
  WHERE d.installation_id = installation.id AND d.closure_revision = p_closure_revision
    AND d.old_generation_id = installation.active_generation_id AND d.outcome IS NULL;
  current_clock := private.brilstash_clock();
  finish_by := ((p_window_date + time '23:30') AT TIME ZONE 'Africa/Lagos');
  IF installation.admission <> 'closed' OR p_closure_revision IS DISTINCT FROM installation.serving_revision
    OR drain.evidence_recorded_at IS NULL
    OR p_candidate_id IS DISTINCT FROM drain.opening_candidate_id
    OR p_window_date IS DISTINCT FROM (drain.closed_at AT TIME ZONE 'Africa/Lagos')::date
    OR private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR current_clock + make_interval(secs => drain.promotion_allowance_seconds) > finish_by
    OR EXISTS (SELECT 1 FROM private.brilstash_drain_policies p
      WHERE p.installation_id = installation.id AND p.protected_until >= current_clock)
    OR NOT private.brilstash_replacement_is_valid(installation.id, p_candidate_id,
      private.brilstash_scheduled_pull_end(p_window_date, drain.partner_drain_seconds), current_clock)
  THEN RAISE EXCEPTION 'BrilStash promotion is unavailable' USING ERRCODE = '23514'; END IF;

  current_clock := private.brilstash_clock();
  IF current_clock + make_interval(secs => drain.promotion_allowance_seconds) > finish_by THEN
    RAISE EXCEPTION 'BrilStash promotion window ended' USING ERRCODE = '23514';
  END IF;
  UPDATE private.brilstash_drains SET outcome = 'promoted', completed_at = private.brilstash_clock()
    WHERE installation_id = installation.id AND closure_revision = p_closure_revision;
  UPDATE private.brilstash_installations SET admission = 'open', active_generation_id = p_candidate_id,
    serving_revision = serving_revision + 1 WHERE id = installation.id;
  RETURN p_candidate_id;
END;
$$;

CREATE FUNCTION public.configure_brilstash_drain_policy(
  p_installation_id uuid, p_partner_drain_seconds integer, p_promotion_allowance_seconds integer,
  p_protected_until timestamptz, p_evidence_reference text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF installation.admission = 'closed' THEN
    RAISE EXCEPTION 'BrilStash drain policy is locked during closure' USING ERRCODE = '23514';
  END IF;
  -- Reserve the ten-second response budget within the 22:00–23:30 Lagos window.
  IF p_partner_drain_seconds::bigint + p_promotion_allowance_seconds + 10 > 5400 THEN
    RAISE EXCEPTION 'BrilStash drain budget exceeds the promotion window' USING ERRCODE = '23514';
  END IF;

  INSERT INTO private.brilstash_drain_policies AS existing (
    installation_id, partner_drain_seconds, promotion_allowance_seconds, protected_until, evidence_reference
  ) VALUES (installation.id, p_partner_drain_seconds, p_promotion_allowance_seconds,
    p_protected_until, p_evidence_reference)
  ON CONFLICT (installation_id) DO UPDATE SET
    partner_drain_seconds = EXCLUDED.partner_drain_seconds,
    promotion_allowance_seconds = EXCLUDED.promotion_allowance_seconds,
    protected_until = GREATEST(existing.protected_until, EXCLUDED.protected_until),
    evidence_reference = EXCLUDED.evidence_reference;
END;
$$;

REVOKE ALL ON FUNCTION private.brilstash_scheduled_pull_end(date, integer),
  private.brilstash_replacement_is_valid(uuid, uuid, timestamptz, timestamptz),
  public.configure_brilstash_drain_policy(uuid, integer, integer, timestamptz, text),
  public.close_brilstash_admission(uuid, uuid, date),
  public.observe_brilstash_closure(uuid, bigint),
  public.record_brilstash_drain_evidence(uuid, bigint, text, text),
  public.promote_brilstash_snapshot(uuid, uuid, date, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configure_brilstash_drain_policy(uuid, integer, integer, timestamptz, text),
  public.close_brilstash_admission(uuid, uuid, date),
  public.observe_brilstash_closure(uuid, bigint),
  public.record_brilstash_drain_evidence(uuid, bigint, text, text),
  public.promote_brilstash_snapshot(uuid, uuid, date, bigint) TO authenticated;
