ALTER TABLE private.brilstash_installations
  ADD COLUMN source_on_demand boolean NOT NULL DEFAULT false;

-- Keep the normal binding path and its authorization, uniqueness and revision
-- rules. The capability is selected once, before any catalogue can be staged.
CREATE FUNCTION public.bind_brilstash_on_demand_installation(
  p_merchant_id uuid, p_partner_identity text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation_id uuid;
BEGIN
  installation_id := public.bind_brilstash_installation(p_merchant_id, p_partner_identity, true);
  UPDATE private.brilstash_installations SET source_on_demand = true
  WHERE id = installation_id;
  RETURN installation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_brilstash_on_demand_installation(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bind_brilstash_on_demand_installation(uuid, text) TO authenticated;

-- The builder reads a whole assortment in one statement. Ineligible rows
-- retain their external ID so the staging gate can detect a disappearance.
CREATE OR REPLACE FUNCTION private.brilstash_source_rows(p_installation_id uuid, p_merchant_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH approved AS (
    SELECT l.id, l.external_id, l.pilot_slot, l.source_kind, l.source_id,
      l.parent_product_id, l.reviewed_identity, l.approved_facts_revision, i.source_on_demand
    FROM private.brilstash_listings l
    JOIN private.brilstash_installations i ON i.id = l.installation_id
    WHERE i.id = p_installation_id AND i.merchant_id = p_merchant_id
      AND l.retired_at IS NULL
  ),
  -- Match the storefront PDP population. The canonical variant table has
  -- no active/status/archive columns. Removed variants are absent here.
  public_variants AS NOT MATERIALIZED (
    SELECT v.id, v.merchant_id, v.product_id, v.condition, v.attributes,
      v.price_override, v.stock_quantity, v.inventory_tracking_policy
    FROM public.product_variants v
    WHERE v.merchant_id = p_merchant_id AND v.is_inventory_anchor IS NOT TRUE
  ),
  resolved AS (
    SELECT a.*, p.id AS product_id, p.name, p.slug, p.brand,
      p.condition AS parent_condition, p.images AS product_images,
      o.images AS offer_images, m.payout_currency, p.manage_stock, p.stock,
      c.partner_category, c.category_id,
      CASE a.source_kind
        WHEN 'variant' THEN v.condition
        WHEN 'offer' THEN o.condition
        ELSE p.condition
      END AS exact_condition,
      CASE a.source_kind
        WHEN 'variant' THEN COALESCE(v.price_override, p.price)
        WHEN 'offer' THEN o.price
        ELSE p.price
      END AS price_naira,
      CASE a.source_kind
        WHEN 'variant' THEN v.stock_quantity
        WHEN 'offer' THEN o.stock_quantity
        -- Use the field that order creation atomically decrements.
        ELSE p.stock_quantity
      END AS scalar_stock,
      COALESCE(NULLIF(CASE WHEN a.source_kind = 'variant'
        THEN v.inventory_tracking_policy ELSE anchor.inventory_tracking_policy END, 'inherit'),
        NULLIF(p.inventory_tracking_policy, 'inherit'), 'off') AS stock_policy,
      CASE a.source_kind
        WHEN 'variant' THEN v.id IS NOT NULL AND shape.has_variants
          AND v.attributes = a.reviewed_identity->'attributes'
        WHEN 'offer' THEN o.id IS NOT NULL AND p.has_condition_offers IS TRUE AND NOT shape.has_variants
        ELSE NOT shape.has_variants
      END AS exact_source
    FROM approved a
    LEFT JOIN public.products p ON p.id = a.parent_product_id AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
    LEFT JOIN public.merchants m ON m.id = p.merchant_id AND m.is_published IS TRUE
    LEFT JOIN public_variants v ON a.source_kind = 'variant' AND v.id = a.source_id
      AND v.product_id = p.id AND v.merchant_id = p.merchant_id
    LEFT JOIN public.product_variants anchor ON anchor.id = p.inventory_anchor_variant_id
      AND anchor.product_id = p.id AND anchor.merchant_id = p.merchant_id AND anchor.is_inventory_anchor IS TRUE
    LEFT JOIN LATERAL (
      SELECT offers.id, offers.condition, offers.price, offers.stock_quantity, offers.images
      FROM (
        SELECT po.id, po.condition, po.price, po.stock_quantity, po.images
        FROM public.product_offers po
        WHERE a.source_kind = 'offer' AND po.product_id = p.id AND po.merchant_id = p.merchant_id
          AND po.status = 'active'
        ORDER BY po.condition, po.id
        LIMIT 16
      ) offers
      WHERE offers.id = a.source_id
    ) o ON true
    CROSS JOIN LATERAL (
      SELECT (p.has_variants IS TRUE OR COALESCE(p.variant_model, '') = 'sku_matrix'
        -- The public variant scan excludes internal inventory anchors.
        OR EXISTS (SELECT 1 FROM public_variants child
          WHERE child.product_id = p.id AND child.merchant_id = p.merchant_id)) AS has_variants
    ) shape
    LEFT JOIN LATERAL (
      SELECT min(mapping.partner_category) AS partner_category,
        min(mapping.merchant_category_id::text) AS category_id
      FROM private.brilstash_category_mappings mapping
      JOIN public.categories category ON category.id = mapping.merchant_category_id
        AND category.merchant_id = p.merchant_id AND category.is_active IS TRUE
      WHERE mapping.installation_id = p_installation_id AND (
        mapping.merchant_category_id = p.category_id OR EXISTS (
          SELECT 1 FROM public.product_categories membership
          WHERE membership.product_id = p.id AND membership.category_id = mapping.merchant_category_id
        )
      )
      HAVING count(*) = 1
    ) c ON true
    WHERE m.id IS NOT NULL
  ),
  eligible AS (
    SELECT q.*
    FROM resolved q
    WHERE q.exact_source IS TRUE AND q.exact_condition = q.reviewed_identity->>'condition'
      -- The categorized PDP drops offers matching their parent's normalized condition.
      AND (q.source_kind <> 'offer' OR (
        -- The order writer rejects selected offers backed by a serialized pool.
        q.stock_policy = 'off'
        AND private.brilstash_canonical_offer_condition(q.exact_condition) IS NOT NULL
        AND private.brilstash_canonical_offer_condition(q.exact_condition)
          IS DISTINCT FROM private.brilstash_canonical_offer_condition(q.parent_condition)
      ))
    -- The PDP rejects a truncated variant matrix rather than resolving a subset.
      AND (q.source_kind <> 'variant' OR (
        SELECT count(*) FROM (
          SELECT 1 FROM public_variants child
          WHERE child.product_id = q.product_id AND child.merchant_id = p_merchant_id LIMIT 129
        ) capped
      ) <= 128)
  )
  SELECT jsonb_build_object(
    'externalId', a.external_id,
    'id', a.source_id,
    'kind', a.source_kind,
    'parentProductId', a.parent_product_id,
    'visible', e.id IS NOT NULL,
    'name', e.name,
    'slug', e.slug,
    'brand', e.brand,
    'condition', e.exact_condition,
    'parentCondition', e.parent_condition,
    'currency', e.payout_currency,
    'priceNaira', e.price_naira,
    'partnerCategory', e.partner_category,
    'categoryId', e.category_id,
    'factsRevision', CASE WHEN e.id IS NOT NULL THEN f.revision::text ELSE NULL END,
    'approvedFacts', CASE WHEN e.id IS NOT NULL AND f.revision IS NOT NULL
      THEN jsonb_build_object('specifications', f.specifications, 'boxContents', f.box_contents,
        'warranty', f.warranty) ELSE NULL END,
    'verifiedImages', COALESCE(media.urls, '[]'::jsonb),
    'inventory', CASE
      -- A null quantity keeps unbounded serialized products and variants out of the feed.
      WHEN e.stock_policy = 'serialized_then_unlimited'
        THEN jsonb_build_object('kind', 'quantity', 'units', NULL, 'legacyUnits', NULL)
      WHEN e.stock_policy = 'serialized_strict'
        THEN jsonb_build_object('kind', 'serialized', 'units', COALESCE(units.public_available_units, 0))
      -- The storefront order write decrements ordinary quantity stock only for true.
      -- An explicit condition offer uses its own allocation regardless of the parent flag.
      WHEN a.source_kind = 'offer' OR (e.stock_policy = 'off' AND e.manage_stock IS TRUE)
        THEN jsonb_build_object('kind', 'quantity', 'units', e.scalar_stock,
          'legacyUnits', CASE WHEN a.source_kind = 'product' THEN e.stock ELSE NULL END)
      WHEN e.id IS NOT NULL AND withdrawal.id IS NOT NULL
        THEN jsonb_build_object('kind', 'withdrawn', 'units', 0, 'approvalId', withdrawal.id)
      -- The explicit installation policy supplies capacity for approved, otherwise
      -- untracked items. A reviewed withdrawal above still takes precedence.
      WHEN e.source_on_demand IS TRUE AND e.manage_stock IS FALSE AND e.stock_policy = 'off'
        THEN jsonb_build_object('kind', 'on-demand', 'units', 100)
      ELSE jsonb_build_object('kind', 'untracked')
    END
  )
  FROM approved a
  LEFT JOIN eligible e ON e.id = a.id
  LEFT JOIN private.brilstash_listing_facts f ON f.installation_id = p_installation_id
    AND f.listing_id = a.id AND f.revision = a.approved_facts_revision
  LEFT JOIN LATERAL (
    SELECT w.id
    FROM private.brilstash_stock_withdrawals w
    JOIN private.brilstash_installations i ON i.id = w.installation_id
    JOIN private.brilstash_generations active ON active.installation_id = i.id AND active.id = i.active_generation_id
    WHERE e.id IS NOT NULL AND w.installation_id = p_installation_id AND w.listing_id = a.id
      AND (
        w.prior_generation_id = active.id
        OR active.source_manifest @> jsonb_build_array(jsonb_build_object(
          'externalId', a.external_id, 'stockWithdrawalId', w.id
        ))
      )
    ORDER BY w.reviewed_at DESC, w.id LIMIT 1
  ) withdrawal ON true
  LEFT JOIN LATERAL (
    SELECT s.public_available_units
    FROM private.get_public_serialized_variant_availability_counts(p_merchant_id, ARRAY[e.product_id], NULL) s
    WHERE e.stock_policy = 'serialized_strict'
      AND s.product_id = e.product_id AND s.variant_id IS NOT DISTINCT FROM
        CASE WHEN a.source_kind = 'variant' THEN a.source_id ELSE NULL END
  ) units ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(img.verified_url ORDER BY img.is_primary DESC, img.position, img.id) AS urls
    FROM (
      SELECT manifest.id, manifest.is_primary, manifest.position, manifest.verified_url
      FROM public.product_feed_images manifest
      WHERE manifest.product_id = e.product_id AND manifest.merchant_id = p_merchant_id
        AND manifest.status = 'verified' AND manifest.verified_url LIKE 'https://%'
        AND (
          (a.source_kind = 'variant' AND manifest.variant_id = a.source_id)
          OR (a.source_kind <> 'variant' AND manifest.variant_id IS NULL AND EXISTS (
            SELECT 1 FROM public.feed_manifest_image_urls(
              CASE WHEN a.source_kind = 'offer' THEN e.offer_images ELSE e.product_images END
            ) AS claimed(url)
            WHERE claimed.url IN (manifest.source_url, manifest.verified_url)
          ))
        )
      ORDER BY manifest.is_primary DESC, manifest.position, manifest.id
      LIMIT 10
    ) img
  ) media ON true
  ORDER BY a.pilot_slot
$$;

CREATE OR REPLACE FUNCTION public.approve_brilstash_stock_withdrawal(
  p_installation_id uuid, p_expected_revision bigint, p_external_id text, p_evidence_reference text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE installation private.brilstash_installations;
DECLARE listing_id uuid;
DECLARE approval_id uuid;
BEGIN
  installation := private.brilstash_lock_operator(p_installation_id);
  IF p_expected_revision IS DISTINCT FROM installation.catalogue_revision THEN
    RAISE EXCEPTION 'BrilStash catalogue revision changed' USING ERRCODE = '40001';
  END IF;

  -- Only an exact, still-public source from the current published generation
  -- can qualify. Null counts and ambiguous stock are not untracked stock.
  SELECT l.id INTO listing_id
  FROM private.brilstash_listings l
  JOIN private.brilstash_generations prior ON prior.installation_id = l.installation_id
    AND prior.id = installation.active_generation_id
  JOIN LATERAL private.brilstash_source_rows(installation.id, installation.merchant_id) source(row)
    ON source.row->>'externalId' = l.external_id
  WHERE l.installation_id = installation.id AND l.external_id = p_external_id
    AND l.retired_at IS NULL AND installation.activated_at IS NOT NULL
    AND source.row->>'visible' = 'true'
    AND source.row->'inventory'->>'kind' IN ('untracked', 'on-demand')
    AND prior.payload @> jsonb_build_array(jsonb_build_object('external_id', l.external_id))
    AND prior.source_manifest @> jsonb_build_array(jsonb_build_object(
      'externalId', l.external_id, 'sourceKind', l.source_kind, 'sourceId', l.source_id,
      'parentProductId', l.parent_product_id, 'reviewedIdentity', l.reviewed_identity
    ));
  IF listing_id IS NULL OR COALESCE(char_length(btrim(p_evidence_reference)), 0) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'BrilStash source does not qualify for zero-stock withdrawal' USING ERRCODE = '23514';
  END IF;

  INSERT INTO private.brilstash_stock_withdrawals(
    installation_id, listing_id, prior_generation_id, evidence_reference, reviewed_by
  ) VALUES (installation.id, listing_id, installation.active_generation_id, p_evidence_reference, auth.uid())
  RETURNING id INTO approval_id;
  UPDATE private.brilstash_installations SET catalogue_revision = catalogue_revision + 1
  WHERE id = installation.id;
  RETURN approval_id;
END;
$$;
