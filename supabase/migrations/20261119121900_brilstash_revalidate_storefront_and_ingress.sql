-- Revalidate storefront ownership at activation and before serving a frozen
-- generation. A domain can be disconnected or claimed by another merchant.
CREATE FUNCTION private.brilstash_host_belongs_to_merchant(p_merchant_id uuid, p_hostname text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants merchant
    WHERE merchant.id = p_merchant_id AND merchant.is_published IS TRUE
      AND (p_hostname = merchant.slug || '.usebaci.com' OR EXISTS (
        SELECT 1 FROM public.domains domain
        WHERE domain.merchant_id = merchant.id AND domain.domain = regexp_replace(p_hostname, '^www[.]', '')
          AND domain.status = 'active'
      ))
  )
$$;
REVOKE ALL ON FUNCTION private.brilstash_host_belongs_to_merchant(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.brilstash_candidate_display_is_authoritative(
  p_merchant_id uuid, p_payload jsonb, p_rows jsonb
)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload) item
    LEFT JOIN jsonb_array_elements(p_rows) source ON source->>'externalId' = item->>'external_id'
    CROSS JOIN LATERAL (
      SELECT substring(item->>'product_url' FROM '^https://([a-z0-9.-]+)/') AS hostname,
        private.brilstash_storefront_slug_segment(source->>'slug') AS slug_segment,
        CASE source->>'condition'
          WHEN 'new' THEN 'New' WHEN 'used' THEN 'Used' WHEN 'uk_used' THEN 'UK Used'
          WHEN 'open_box' THEN 'Open Box' WHEN 'refurbished' THEN 'Refurbished'
        END AS condition_label,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'specifications') AS specifications,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'boxContents') AS box,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'warranty') AS warranty
    ) display
    WHERE source IS NULL
      OR display.hostname IS NULL OR display.slug_segment IS NULL
      OR NOT private.brilstash_host_belongs_to_merchant(p_merchant_id, display.hostname)
      OR item->>'product_url' IS DISTINCT FROM (
        'https://' || display.hostname || '/products/' || display.slug_segment ||
        CASE source->>'kind'
          WHEN 'variant' THEN '?variantId=' || (source->>'id') || '&condition=' || (source->>'condition')
          WHEN 'offer' THEN '?offer_id=' || (source->>'id') || '&condition=' || (source->>'condition')
          WHEN 'product' THEN ''
        END
      )
      OR NULLIF(display.specifications, '') IS NULL OR NULLIF(display.box, '') IS NULL
      OR NULLIF(display.warranty, '') IS NULL OR display.condition_label IS NULL
      OR item->>'title' IS DISTINCT FROM private.brilstash_sanitize_display(source->>'name')
      OR item->>'description' IS DISTINCT FROM (
        'Condition: ' || display.condition_label || '. Specifications: ' || display.specifications ||
        '. Box contents: ' || display.box || '. Warranty: ' || display.warranty || '.'
      )
      OR item->>'brand' IS DISTINCT FROM NULLIF(private.brilstash_sanitize_display(source->>'brand'), '')
      OR item ? 'model_number'
  )
$$;

CREATE OR REPLACE FUNCTION private.brilstash_check_display_before_serving()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE candidate jsonb;
DECLARE source_rows jsonb;
BEGIN
  IF NEW.active_generation_id IS NULL OR NEW.active_generation_id IS NOT DISTINCT FROM OLD.active_generation_id THEN
    RETURN NEW;
  END IF;

  SELECT g.payload INTO candidate FROM private.brilstash_generations g
    WHERE g.installation_id = NEW.id AND g.id = NEW.active_generation_id;
  SELECT COALESCE(jsonb_agg(source.row), '[]'::jsonb) INTO source_rows
    FROM private.brilstash_source_rows(NEW.id, NEW.merchant_id) source(row);

  IF private.brilstash_candidate_display_is_authoritative(NEW.merchant_id, candidate, source_rows)
      IS DISTINCT FROM true OR EXISTS (
    SELECT 1
    FROM private.brilstash_generations g
    CROSS JOIN LATERAL jsonb_array_elements(g.source_manifest) frozen
    LEFT JOIN jsonb_array_elements(source_rows) current_row
      ON current_row->>'externalId' = frozen->>'externalId'
    WHERE g.installation_id = NEW.id AND g.id = NEW.active_generation_id
      AND (frozen->'display' IS NULL
        OR frozen->'display' IS DISTINCT FROM private.brilstash_source_display(current_row))
  ) THEN
    RAISE EXCEPTION 'BrilStash staged display data changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
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
        SELECT 1 FROM jsonb_array_elements(g.payload) item
        WHERE NOT private.brilstash_host_belongs_to_merchant(
          i.merchant_id, substring(item->>'product_url' FROM '^https://([a-z0-9.-]+)/')
        )
      )
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

-- Distinguish the deployment trust check from partner authentication.
CREATE OR REPLACE FUNCTION public.read_brilstash_page(p_bearer text, p_page integer, p_limit integer, p_min_price numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE access_claim record;
DECLARE page_result jsonb;
BEGIN
  IF p_bearer IS NULL OR octet_length(p_bearer) NOT BETWEEN 32 AND 256
    OR p_bearer !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;
  IF NOT private.brilstash_ingress_is_authorized(p_bearer) THEN
    RETURN jsonb_build_object('status', 'ingress_unavailable');
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
