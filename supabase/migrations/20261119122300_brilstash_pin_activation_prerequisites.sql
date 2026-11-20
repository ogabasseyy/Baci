-- Preserve the ordered, exact verified manifest URLs in every staged payload.
CREATE OR REPLACE FUNCTION private.brilstash_candidate_matches_sources(p_payload jsonb, p_rows jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT jsonb_array_length(p_payload) = jsonb_array_length(p_rows)
    AND jsonb_array_length(p_payload) = (
      SELECT count(DISTINCT item->>'external_id') FROM jsonb_array_elements(p_payload) item
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_rows) source
      LEFT JOIN LATERAL (
        SELECT item FROM jsonb_array_elements(p_payload) item
        WHERE item->>'external_id' = source->>'externalId'
      ) candidate ON true
      WHERE candidate.item IS NULL
        OR source->>'visible' IS DISTINCT FROM 'true'
        OR source->>'factsRevision' IS NULL
        OR source->>'currency' IS DISTINCT FROM 'NGN'
        OR candidate.item->'category' IS DISTINCT FROM source->'partnerCategory'
        OR candidate.item->'price_naira' IS DISTINCT FROM source->'priceNaira'
        OR candidate.item->'stock_quantity' IS DISTINCT FROM source->'inventory'->'units'
        OR candidate.item->'images' IS DISTINCT FROM (
          SELECT jsonb_agg(jsonb_build_object('url', verified.url) ORDER BY verified.first_position)
          FROM (
            SELECT image.url, min(image.position) AS first_position
            FROM jsonb_array_elements_text(source->'verifiedImages') WITH ORDINALITY image(url, position)
            GROUP BY image.url
            ORDER BY min(image.position)
            LIMIT 10
          ) verified
        )
        OR source->'inventory'->>'units' IS NULL
        OR source->'inventory'->>'kind' = 'untracked'
        OR (source->'inventory'->'units' = '0'::jsonb
            AND COALESCE((source->'inventory'->>'legacyUnits')::integer, 0) > 0)
    )
$$;

-- Every read or activation needs qualified bounds for the partner pull.
CREATE OR REPLACE FUNCTION private.brilstash_read_is_fresh(
  p_installation_id uuid, p_read_at timestamptz, p_now timestamptz, p_include_upcoming boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH clock_context AS (
    SELECT (p_now AT TIME ZONE 'Africa/Lagos')::date AS lagos_date
  )
  SELECT COALESCE(
    d.installation_id IS NOT NULL AND p_read_at <= p_now AND p_read_at + interval '26 hours' > GREATEST(
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

-- Stamp the fresh-installation attestation with the database clock.
CREATE OR REPLACE FUNCTION public.record_brilstash_fresh_installation(
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
    installation_id, partner_identity, evidence_reference, recorded_by, recorded_at
  ) VALUES (installation.id, installation.partner_identity, p_evidence_reference, auth.uid(), private.brilstash_clock())
  RETURNING id INTO evidence_id;
  RETURN evidence_id;
END;
$$;

-- Require evidence recorded in the preceding five minutes through activation.
CREATE OR REPLACE FUNCTION public.activate_first_brilstash_snapshot(
  p_installation_id uuid, p_candidate_id uuid, p_window_date date, p_evidence_id uuid, p_approval_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE current_clock timestamptz;
DECLARE candidate jsonb;
DECLARE source_read_at timestamptz;
DECLARE current_rows jsonb;
DECLARE evidence_recorded_at timestamptz;
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

  SELECT g.payload, g.source_read_at, e.recorded_at INTO candidate, source_read_at, evidence_recorded_at
  FROM private.brilstash_generations g
  JOIN private.brilstash_candidate_approvals a ON a.installation_id = g.installation_id
    AND a.candidate_id = g.id AND a.payload_digest = g.payload_digest
    AND a.catalogue_revision = g.catalogue_revision
  JOIN private.brilstash_fresh_installation_evidence e ON e.installation_id = g.installation_id
    AND e.id = p_evidence_id AND e.partner_identity = installation.partner_identity
  WHERE g.installation_id = installation.id AND g.id = p_candidate_id AND a.id = p_approval_id
    AND g.catalogue_revision = installation.catalogue_revision
    AND e.recorded_at <= current_clock AND e.recorded_at + interval '5 minutes' > current_clock
    AND g.expected_active_generation_id IS NULL
    AND private.brilstash_read_is_fresh(installation.id, g.source_read_at, current_clock, true);

  SELECT COALESCE(jsonb_agg(source.row), '[]'::jsonb) INTO current_rows
  FROM private.brilstash_source_rows(installation.id, installation.merchant_id) source(row);
  IF candidate IS NULL OR NOT private.brilstash_candidate_matches_sources(candidate, current_rows) THEN
    RAISE EXCEPTION 'BrilStash activation evidence or candidate is invalid' USING ERRCODE = '23514';
  END IF;
  current_clock := private.brilstash_clock();
  IF private.brilstash_promotion_window_allows(p_window_date, current_clock) IS DISTINCT FROM true
    OR evidence_recorded_at > current_clock OR evidence_recorded_at + interval '5 minutes' <= current_clock
    OR NOT private.brilstash_read_is_fresh(installation.id, source_read_at, current_clock, true)
  THEN
    RAISE EXCEPTION 'BrilStash activation window, evidence or freshness ended' USING ERRCODE = '23514';
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
