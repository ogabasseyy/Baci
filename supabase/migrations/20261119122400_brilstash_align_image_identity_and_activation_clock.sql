-- Agree with the application on HTTPS image identity while preserving verified URL bytes.
CREATE FUNCTION private.brilstash_image_url_key(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE WHEN parts[1] IS NOT NULL AND char_length(rtrim(parts[1], '.')) <= 253
      AND COALESCE(parts[2]::integer, 443) <= 65535
      AND p_url COLLATE "C" !~ '[^!-~]' AND strpos(p_url, '#') = 0 AND strpos(p_url, chr(92)) = 0
    THEN 'https://' || lower(parts[1] COLLATE "C")
      || CASE WHEN COALESCE(parts[2]::integer, 443) = 443 THEN '' ELSE ':' || (parts[2]::integer)::text END
      || CASE WHEN left(parts[3], 1) = '/' THEN parts[3] ELSE '/' || COALESCE(parts[3], '') END END
  FROM (
    SELECT regexp_match(p_url COLLATE "C",
      '^https://((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?[.]?)(?::([0-9]{1,5}))?([/?].*)?$', 'i') AS parts
  ) matched
$$;

CREATE FUNCTION private.brilstash_expected_verified_images(p_urls jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  WITH manifest AS MATERIALIZED (
    SELECT url, position, private.brilstash_image_url_key(url) AS url_key
    FROM jsonb_array_elements_text(p_urls) WITH ORDINALITY AS images(url, position)
  ), unique_images AS (
    SELECT DISTINCT ON (url_key COLLATE "C") url, position
    FROM manifest ORDER BY url_key COLLATE "C", position
  ), first_images AS (
    SELECT url, position FROM unique_images ORDER BY position LIMIT 10
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM manifest WHERE url_key IS NULL) THEN (
    SELECT jsonb_agg(jsonb_build_object('url', url) ORDER BY position) FROM first_images
  ) END
$$;

REVOKE ALL ON FUNCTION private.brilstash_image_url_key(text),
  private.brilstash_expected_verified_images(jsonb) FROM PUBLIC, anon, authenticated, service_role;

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
        OR candidate.item->'images' IS DISTINCT FROM
          private.brilstash_expected_verified_images(source->'verifiedImages')
        OR source->'inventory'->>'units' IS NULL
        OR source->'inventory'->>'kind' = 'untracked'
        OR (source->'inventory'->'units' = '0'::jsonb
            AND COALESCE((source->'inventory'->>'legacyUnits')::integer, 0) > 0)
    )
$$;

CREATE FUNCTION private.brilstash_first_activation_is_current(
  p_installation_id uuid, p_window_date date, p_source_read_at timestamptz,
  p_evidence_recorded_at timestamptz, p_now timestamptz
)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT private.brilstash_promotion_window_allows(p_window_date, p_now)
    AND p_evidence_recorded_at <= p_now AND p_evidence_recorded_at + interval '5 minutes' > p_now
    AND private.brilstash_read_is_fresh(p_installation_id, p_source_read_at, p_now, true)
$$;

REVOKE ALL ON FUNCTION private.brilstash_first_activation_is_current(uuid, date, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

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
    AND g.expected_active_generation_id IS NULL
    AND private.brilstash_first_activation_is_current(
      installation.id, p_window_date, g.source_read_at, e.recorded_at, current_clock
    );

  SELECT COALESCE(jsonb_agg(source.row), '[]'::jsonb) INTO current_rows
  FROM private.brilstash_source_rows(installation.id, installation.merchant_id) source(row);
  IF candidate IS NULL OR NOT private.brilstash_candidate_matches_sources(candidate, current_rows) THEN
    RAISE EXCEPTION 'BrilStash activation evidence or candidate is invalid' USING ERRCODE = '23514';
  END IF;
  current_clock := private.brilstash_clock();
  IF private.brilstash_first_activation_is_current(
    installation.id, p_window_date, source_read_at, evidence_recorded_at, current_clock
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BrilStash activation window, evidence or freshness ended' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.brilstash_first_activations (
    installation_id, approval_id, evidence_id, generation_id, activated_by, activated_at
  ) VALUES (installation.id, p_approval_id, p_evidence_id, p_candidate_id, auth.uid(), current_clock);
  UPDATE private.brilstash_installations SET active_generation_id = p_candidate_id,
    activated_at = current_clock, admission = 'open', serving_revision = serving_revision + 1
  WHERE id = installation.id;
  -- Revalidate after the pointer update's database display checks have run.
  current_clock := private.brilstash_clock();
  IF private.brilstash_first_activation_is_current(
    installation.id, p_window_date, source_read_at, evidence_recorded_at, current_clock
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BrilStash activation window, evidence or freshness ended' USING ERRCODE = '23514';
  END IF;
  RETURN p_candidate_id;
END;
$$;
