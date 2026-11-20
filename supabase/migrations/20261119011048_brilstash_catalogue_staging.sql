-- Keep the digest independent of JSON formatting and object key order.
-- Catalogue numbers are fixed-point PostgreSQL values, not exponent strings.
CREATE FUNCTION private.brilstash_canonical_json(value jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(
        to_jsonb(item.key)::text || ':' || private.brilstash_canonical_json(item.value),
        ',' ORDER BY item.key COLLATE "C"
      ), '') || '}' INTO result FROM jsonb_each(value) item;
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(
        private.brilstash_canonical_json(item.value), ',' ORDER BY item.ordinal
      ), '') || ']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY item(value, ordinal);
    WHEN 'number' THEN
      result := trim_scale((value #>> '{}')::numeric)::text;
    ELSE result := value::text;
  END CASE;
  RETURN result;
END;
$$;

CREATE FUNCTION private.brilstash_payload_has_wire_shape(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE item jsonb;
DECLARE image jsonb;
DECLARE field text;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
    IF jsonb_typeof(item) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(item) AS keys(key)
      WHERE key NOT IN ('external_id', 'product_url', 'title', 'description', 'category',
        'price_naira', 'stock_quantity', 'images', 'brand', 'model_number')
    ) THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['external_id', 'product_url', 'title', 'description',
      'category', 'brand', 'model_number'] LOOP
      IF field IN ('brand', 'model_number') AND NOT (item ? field) THEN CONTINUE; END IF;
      IF jsonb_typeof(item->field) IS DISTINCT FROM 'string'
        OR btrim(item->>field) = '' OR item->>field ~ '[<>[:cntrl:]]'
      THEN RETURN false; END IF;
    END LOOP;
    IF item->>'product_url' !~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?([/?]|$)'
      OR substring(lower(item->>'product_url') FROM '^https://[a-z0-9.-]+:([0-9]{1,5})[/?]?')::integer > 65535
      OR item->>'product_url' ~ '[#[:space:][:cntrl:]]' OR strpos(item->>'product_url', chr(92)) > 0
      OR
      jsonb_typeof(item->'price_naira') IS DISTINCT FROM 'number' OR
      jsonb_typeof(item->'stock_quantity') IS DISTINCT FROM 'number' OR
      jsonb_typeof(item->'images') IS DISTINCT FROM 'array'
    THEN RETURN false; END IF;
    IF (item->>'price_naira')::numeric NOT BETWEEN 0.01 AND 9007199254740991
      OR (item->>'stock_quantity')::numeric NOT BETWEEN 0 AND 9007199254740991
      OR (item->>'stock_quantity')::numeric <> trunc((item->>'stock_quantity')::numeric)
      OR jsonb_array_length(item->'images') NOT BETWEEN 1 AND 10
    THEN RETURN false; END IF;
    FOR image IN SELECT value FROM jsonb_array_elements(item->'images') LOOP
      IF jsonb_typeof(image) <> 'object'
        OR jsonb_typeof(image->'url') IS DISTINCT FROM 'string'
        OR image - 'url' <> '{}'::jsonb
        OR image->>'url' !~ '^https://[^/?#@]+([/?]|$)'
        OR image->>'url' ~ '[#[:space:][:cntrl:]]' OR strpos(image->>'url', chr(92)) > 0
      THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION private.brilstash_candidate_matches_sources(p_payload jsonb, p_rows jsonb)
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
        OR jsonb_array_length(candidate.item->'images') <> (
          SELECT count(DISTINCT image->>'url') FROM jsonb_array_elements(candidate.item->'images') image
          WHERE (source->'verifiedImages') ? (image->>'url')
        )
        OR source->'inventory'->>'units' IS NULL
        OR source->'inventory'->>'kind' = 'untracked'
        OR (source->'inventory'->'units' = '0'::jsonb
            AND COALESCE((source->'inventory'->>'legacyUnits')::integer, 0) > 0)
    )
$$;

CREATE FUNCTION public.stage_brilstash_catalogue_snapshot(
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
    'stockWithdrawalId', source.row->'inventory'->'approvalId'
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

REVOKE ALL ON FUNCTION private.brilstash_canonical_json(jsonb),
  private.brilstash_candidate_matches_sources(jsonb, jsonb),
  private.brilstash_payload_has_wire_shape(jsonb),
  public.stage_brilstash_catalogue_snapshot(uuid, uuid, bigint, uuid, timestamptz, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_brilstash_catalogue_snapshot(
  uuid, uuid, bigint, uuid, timestamptz, jsonb, jsonb, text
) TO authenticated;
