-- A retired binding remains permanent history. A merchant can qualify one
-- fresh installation after retirement, with a different partner identity.
CREATE UNIQUE INDEX brilstash_installations_current_merchant_idx
  ON private.brilstash_installations (merchant_id) WHERE retired_at IS NULL;

CREATE FUNCTION private.brilstash_source_display(p_row jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT jsonb_build_object('name', p_row->'name', 'slug', p_row->'slug', 'brand', p_row->'brand')
$$;
REVOKE ALL ON FUNCTION private.brilstash_source_display(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stage_brilstash_catalogue_snapshot(
  p_installation_id uuid,
  p_candidate_id uuid,
  p_catalogue_revision bigint,
  p_expected_active_generation_id uuid,
  p_source_read_at timestamptz,
  p_source_rows jsonb,
  p_payload jsonb,
  p_payload_digest text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  installation private.brilstash_installations%ROWTYPE;
  existing record;
  current_rows jsonb;
  manifest jsonb;
BEGIN
  SELECT i.id, i.merchant_id, i.partner_identity, i.active_generation_id, i.activated_at,
    i.retired_at, i.admission, i.catalogue_revision, i.serving_revision, i.credential_revision
  INTO installation
  FROM private.brilstash_installations i
  WHERE i.id = p_installation_id AND i.retired_at IS NULL
    AND EXISTS (
      SELECT 1 FROM private.brilstash_builder_entitlements e
      WHERE e.installation_id = i.id AND e.user_id = (SELECT auth.uid())
    )
  FOR UPDATE;
  IF installation.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM private.brilstash_builder_entitlements e
    WHERE e.installation_id = p_installation_id AND e.user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'BrilStash builder access denied' USING ERRCODE = '42501';
  END IF;

  IF p_candidate_id IS NULL OR p_catalogue_revision IS NULL OR p_source_read_at IS NULL
    OR jsonb_typeof(p_source_rows) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'array'
    OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$'
    OR pg_column_size(p_source_rows) > 524288 OR pg_column_size(p_payload) > 524288
  THEN
    RAISE EXCEPTION 'Invalid BrilStash candidate' USING ERRCODE = '23514';
  END IF;

  SELECT g.id, g.expected_active_generation_id, g.catalogue_revision,
    g.source_read_at, g.payload, g.payload_digest
  INTO existing
  FROM private.brilstash_generations g
  WHERE g.installation_id = p_installation_id AND g.id = p_candidate_id;
  IF existing.id IS NOT NULL THEN
    IF (existing.catalogue_revision, existing.expected_active_generation_id,
        existing.source_read_at, existing.payload, existing.payload_digest)
      IS NOT DISTINCT FROM (p_catalogue_revision, p_expected_active_generation_id,
        p_source_read_at, p_payload, p_payload_digest) THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'BrilStash candidate ID already used' USING ERRCODE = '23505';
  END IF;

  IF installation.catalogue_revision <> p_catalogue_revision
    OR installation.active_generation_id IS DISTINCT FROM p_expected_active_generation_id
  THEN
    RAISE EXCEPTION 'BrilStash catalogue changed during build' USING ERRCODE = '40001';
  END IF;
  IF p_source_read_at > statement_timestamp()
    OR p_source_read_at < statement_timestamp() - interval '26 hours' THEN
    RAISE EXCEPTION 'BrilStash source timestamp is outside the staging window' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(source.row ORDER BY source.ordinal), '[]'::jsonb)
  INTO current_rows
  FROM private.brilstash_source_rows(p_installation_id, installation.merchant_id)
    WITH ORDINALITY source(row, ordinal);
  IF current_rows IS DISTINCT FROM p_source_rows THEN
    RAISE EXCEPTION 'BrilStash source changed during build' USING ERRCODE = '40001';
  END IF;

  IF jsonb_array_length(p_payload) NOT BETWEEN 1 AND 7
    OR NOT private.brilstash_payload_has_wire_shape(p_payload)
    OR NOT private.brilstash_candidate_matches_sources(p_payload, current_rows)
    OR p_payload_digest <> encode(sha256(convert_to(private.brilstash_canonical_json(p_payload), 'UTF8')), 'hex')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload) WITH ORDINALITY current_item(item, n)
      JOIN jsonb_array_elements(p_payload) WITH ORDINALITY next_item(item, n) ON next_item.n = current_item.n + 1
      WHERE current_item.item->>'external_id' COLLATE "C" >= next_item.item->>'external_id' COLLATE "C"
    )
    OR EXISTS (
      SELECT 1
      FROM private.brilstash_generations previous
      CROSS JOIN LATERAL jsonb_array_elements(previous.payload) old_item
      WHERE previous.installation_id = p_installation_id AND previous.id = installation.active_generation_id
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload) item
          WHERE item->>'external_id' = old_item->>'external_id')
        AND NOT EXISTS (SELECT 1 FROM private.brilstash_listings listing
          WHERE listing.installation_id = p_installation_id AND listing.external_id = old_item->>'external_id'
            AND listing.retired_at IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'BrilStash candidate failed completeness or integrity checks' USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'externalId', l.external_id, 'sourceKind', l.source_kind, 'sourceId', l.source_id,
    'parentProductId', l.parent_product_id, 'reviewedIdentity', l.reviewed_identity,
    'factsRevision', l.approved_facts_revision::text,
    'stockWithdrawalId', source.row->'inventory'->'approvalId',
    'display', private.brilstash_source_display(source.row)
  ) ORDER BY l.external_id COLLATE "C")
  INTO manifest FROM private.brilstash_listings l
  JOIN LATERAL (
    SELECT row FROM jsonb_array_elements(current_rows) AS rows(row)
    WHERE row->>'externalId' = l.external_id
  ) source ON true
  WHERE l.installation_id = p_installation_id AND l.retired_at IS NULL;

  INSERT INTO private.brilstash_generations (
    installation_id, id, expected_active_generation_id, catalogue_revision,
    source_read_at, payload, payload_digest, source_manifest
  ) VALUES (
    p_installation_id, p_candidate_id, p_expected_active_generation_id, p_catalogue_revision,
    p_source_read_at, p_payload, p_payload_digest, manifest
  );
  RETURN p_candidate_id;
END;
$$;

-- This trigger covers first activation, ordinary promotion, and suspended
-- replacement through the common active-generation pointer.
CREATE FUNCTION private.brilstash_check_display_before_serving()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.active_generation_id IS NULL OR NEW.active_generation_id IS NOT DISTINCT FROM OLD.active_generation_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH current_rows AS MATERIALIZED (
      SELECT source.row
      FROM private.brilstash_source_rows(NEW.id, NEW.merchant_id) source(row)
    )
    SELECT 1
    FROM private.brilstash_generations g
    CROSS JOIN LATERAL jsonb_array_elements(g.source_manifest) frozen
    LEFT JOIN current_rows ON current_rows.row->>'externalId' = frozen->>'externalId'
    WHERE g.installation_id = NEW.id AND g.id = NEW.active_generation_id
      AND (frozen->'display' IS NULL
        OR frozen->'display' IS DISTINCT FROM private.brilstash_source_display(current_rows.row))
  ) THEN
    RAISE EXCEPTION 'BrilStash staged display data changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.brilstash_check_display_before_serving()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER check_brilstash_display_before_serving
BEFORE UPDATE OF active_generation_id ON private.brilstash_installations
FOR EACH ROW EXECUTE FUNCTION private.brilstash_check_display_before_serving();

-- Preserve the frozen payload and reject the pull when it would advertise
-- more units than checkout currently allows.
CREATE OR REPLACE FUNCTION private.brilstash_active_generation_is_eligible(p_installation_id uuid, p_generation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH live_sources AS MATERIALIZED (
    SELECT source.row
    FROM private.brilstash_installations i
    CROSS JOIN LATERAL private.brilstash_source_rows(i.id, i.merchant_id) source(row)
    WHERE i.id = p_installation_id AND i.active_generation_id = p_generation_id
      AND i.admission = 'open' AND i.retired_at IS NULL
  )
  SELECT COALESCE((
    SELECT jsonb_array_length(g.source_manifest) = jsonb_array_length(g.payload)
      AND jsonb_array_length(g.payload) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(g.source_manifest) frozen
        LEFT JOIN private.brilstash_listings listing
          ON listing.installation_id = i.id AND listing.external_id = frozen->>'externalId'
          AND listing.retired_at IS NULL
        LEFT JOIN live_sources current_source
          ON current_source.row->>'externalId' = frozen->>'externalId'
        LEFT JOIN LATERAL (
          SELECT item->>'stock_quantity' AS units
          FROM jsonb_array_elements(g.payload) item
          WHERE item->>'external_id' = frozen->>'externalId'
        ) exported ON true
        WHERE listing.id IS NULL OR current_source.row->>'visible' IS DISTINCT FROM 'true'
          OR listing.source_kind IS DISTINCT FROM frozen->>'sourceKind'
          OR listing.source_id::text IS DISTINCT FROM frozen->>'sourceId'
          OR listing.parent_product_id::text IS DISTINCT FROM frozen->>'parentProductId'
          OR listing.reviewed_identity IS DISTINCT FROM frozen->'reviewedIdentity'
          OR current_source.row->'inventory'->>'kind' = 'untracked'
          OR (current_source.row->'inventory'->>'kind' = 'withdrawn' AND (
            frozen->>'stockWithdrawalId' IS DISTINCT FROM current_source.row->'inventory'->>'approvalId'
            OR NOT (g.payload @> jsonb_build_array(jsonb_build_object(
              'external_id', frozen->>'externalId', 'stock_quantity', 0
            )))
          ))
          OR current_source.row->'inventory'->>'units' IS NULL
          OR exported.units IS NULL
          OR (current_source.row->'inventory'->>'units')::integer < exported.units::integer
          OR (current_source.row->'inventory'->'units' = '0'::jsonb
              AND COALESCE((current_source.row->'inventory'->>'legacyUnits')::integer, 0) > 0)
      )
    FROM private.brilstash_installations i
    JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
    WHERE i.id = p_installation_id AND g.id = p_generation_id
      AND i.admission = 'open' AND i.retired_at IS NULL
  ), false)
$$;
