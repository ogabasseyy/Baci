ALTER TABLE private.brilstash_installations ADD COLUMN single_page_only boolean NOT NULL DEFAULT true;

CREATE ROLE baci_brilstash_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT baci_brilstash_reader TO CURRENT_USER;
GRANT USAGE ON SCHEMA private, public TO baci_brilstash_reader;
GRANT SELECT (installation_id, id, bearer_digest, expires_at, revoked_at)
  ON private.brilstash_credentials TO baci_brilstash_reader;
GRANT SELECT (id, active_generation_id, admission, retired_at, single_page_only)
  ON private.brilstash_installations TO baci_brilstash_reader;
GRANT SELECT (installation_id, id, source_read_at, payload, payload_digest)
  ON private.brilstash_generations TO baci_brilstash_reader;

CREATE POLICY brilstash_reader_select ON private.brilstash_credentials
  FOR SELECT TO baci_brilstash_reader USING (true);
CREATE POLICY brilstash_reader_select ON private.brilstash_installations
  FOR SELECT TO baci_brilstash_reader USING (true);
CREATE POLICY brilstash_reader_select ON private.brilstash_generations
  FOR SELECT TO baci_brilstash_reader USING (true);

-- Only the read RPC's dedicated owner can ask this boolean question. It
-- does not receive internal rows or grants on storefront and approval data.
CREATE FUNCTION private.brilstash_active_generation_is_eligible(p_installation_id uuid, p_generation_id uuid)
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
          OR (current_source.row->'inventory'->'units' = '0'::jsonb
              AND COALESCE((current_source.row->'inventory'->>'legacyUnits')::integer, 0) > 0)
      )
    FROM private.brilstash_installations i
    JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
    WHERE i.id = p_installation_id AND g.id = p_generation_id
      AND i.admission = 'open' AND i.retired_at IS NULL
  ), false)
$$;
REVOKE ALL ON FUNCTION private.brilstash_active_generation_is_eligible(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.brilstash_active_generation_is_eligible(uuid, uuid)
  TO baci_brilstash_reader;

CREATE FUNCTION public.read_brilstash_page(p_bearer text, p_page integer, p_limit integer, p_min_price numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE access_claim record;
DECLARE page_result jsonb;
BEGIN
  IF p_bearer IS NULL OR octet_length(p_bearer) NOT BETWEEN 32 AND 256
    OR p_bearer !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;
  SELECT i.id AS installation_id, i.admission, i.retired_at, i.single_page_only,
    c.id AS credential_id, g.id AS generation_id, g.source_read_at, g.payload, g.payload_digest
  INTO access_claim
  FROM private.brilstash_credentials c
  JOIN private.brilstash_installations i ON i.id = c.installation_id
  LEFT JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
  WHERE c.bearer_digest = sha256(convert_to(p_bearer, 'UTF8'))
    AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > statement_timestamp());
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unauthorized'); END IF;

  IF p_page IS NULL OR p_page < 1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_min_price IS NULL OR p_min_price NOT BETWEEN 0 AND 9007199254740991
    OR (access_claim.single_page_only AND (p_page <> 1 OR p_limit < 7 OR p_min_price <> 0))
  THEN RETURN jsonb_build_object('status', 'invalid_query'); END IF;

  IF access_claim.admission <> 'open' OR access_claim.retired_at IS NOT NULL
    OR access_claim.generation_id IS NULL
    OR NOT private.brilstash_read_is_fresh(access_claim.installation_id, access_claim.source_read_at, statement_timestamp())
    OR NOT private.brilstash_active_generation_is_eligible(access_claim.installation_id, access_claim.generation_id)
  THEN RETURN jsonb_build_object('status', 'unavailable'); END IF;

  WITH matched AS MATERIALIZED (
    SELECT item, ord FROM jsonb_array_elements(access_claim.payload) WITH ORDINALITY rows(item, ord)
    WHERE (item->>'price_naira')::numeric >= p_min_price
  ), paged AS (
    SELECT item, ord FROM matched
    ORDER BY ord LIMIT p_limit OFFSET ((p_page::bigint - 1) * p_limit)
  )
  SELECT jsonb_build_object(
    'status', 'ok', 'products', COALESCE((SELECT jsonb_agg(item ORDER BY ord) FROM paged), '[]'::jsonb),
    'totalCount', count(*), 'totalPages', (count(*) + p_limit - 1) / p_limit,
    'generationId', access_claim.generation_id, 'credentialId', access_claim.credential_id,
    'payloadDigest', access_claim.payload_digest
  ) INTO page_result FROM matched;
  RETURN page_result;
END;
$$;

GRANT CREATE ON SCHEMA public TO baci_brilstash_reader;
ALTER FUNCTION public.read_brilstash_page(text, integer, integer, numeric) OWNER TO baci_brilstash_reader;
REVOKE CREATE ON SCHEMA public FROM baci_brilstash_reader;
REVOKE ALL ON FUNCTION public.read_brilstash_page(text, integer, integer, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_brilstash_page(text, integer, integer, numeric) TO anon;
