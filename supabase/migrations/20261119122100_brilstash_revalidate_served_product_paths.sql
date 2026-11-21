-- Use the same source-derived URL path when staging and serving a generation.
CREATE FUNCTION private.brilstash_source_product_url_suffix(p_source jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT '/products/' || private.brilstash_storefront_slug_segment(p_source->>'slug') ||
    CASE p_source->>'kind'
      WHEN 'variant' THEN '?variantId=' || (p_source->>'id') || '&condition=' || (p_source->>'condition')
      WHEN 'offer' THEN '?offer_id=' || (p_source->>'id') || '&condition=' || (p_source->>'condition')
      WHEN 'product' THEN ''
    END
$$;
REVOKE ALL ON FUNCTION private.brilstash_source_product_url_suffix(jsonb)
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
        private.brilstash_source_product_url_suffix(source) AS suffix,
        CASE source->>'condition'
          WHEN 'new' THEN 'New' WHEN 'used' THEN 'Used' WHEN 'uk_used' THEN 'UK Used'
          WHEN 'open_box' THEN 'Open Box' WHEN 'refurbished' THEN 'Refurbished'
        END AS condition_label,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'specifications') AS specifications,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'boxContents') AS box,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'warranty') AS warranty
    ) display
    WHERE source IS NULL
      OR display.hostname IS NULL OR display.suffix IS NULL
      OR NOT private.brilstash_host_belongs_to_merchant(p_merchant_id, display.hostname)
      OR item->>'product_url' IS DISTINCT FROM (
        'https://' || display.hostname || display.suffix
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
          SELECT item->>'stock_quantity' AS units, item->>'product_url' AS product_url
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
          OR substring(exported.product_url FROM '^https://[a-z0-9.-]+(/products/.*)$')
            IS DISTINCT FROM private.brilstash_source_product_url_suffix(current_source.row)
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
