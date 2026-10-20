-- Append-only: one offer-resolution authority owned by SQL.
--
-- Offer identity, live price basis, and allocatable stock were re-derived
-- per layer: the search price-options offer branch, the web PDP pricing
-- helper, the native cart-stock offer resolver, cart validation, order
-- verification, and the native reprice path each restated the parent
-- gate, the serialized policy caps, and the null-scalar inheritance.
-- get_storefront_offer_resolution owns those rules once: every layer
-- reads (offer_id, live price basis, allocatable stock) from it instead
-- of restating them.
--
-- Returned per active offer row of each requested product:
--   price_basis      live offer price (product_offers.price, NOT NULL).
--   allocatable_stock  effective allocatable units: the finite offer
--     scalar, capped by strict serialized base units; a NULL scalar
--     inherits the parent effective stock (legacy/strict) and stays
--     NULL (unbounded) under serialized_then_unlimited. Live rows
--     always carry a finite scalar (NOT NULL DEFAULT 0); the NULL arm
--     is defensive only.
--   parent_eligible  the order-RPC M28 parent gate verbatim
--     (has_condition_offers, sku_matrix-aware non-variant parent, no
--     live non-anchor variants). Gated-out rows are withheld, not
--     flagged: an ineligible parent reads exactly like a missing
--     offer at every consumer, so no per-consumer flag check can be
--     forgotten. The column stays TRUE on all live rows (contract
--     stability for the search branch and existing callers).
--   Display columns (compare_at_price, grade, condition_notes, images)
--     ride along so detail surfaces need no second lookup.
-- Advertising-only predicates stay with their callers: the
-- same-condition exclusion, the 16-row PDP hydration window, and the
-- 128-variant population cap remain in the search branch below, and
-- PDP identity selection stays in the TypeScript caller module.
-- Batch policy: at most 200 ids unscoped (NULL merchant, which can
-- span merchants) and 1000 ids merchant-scoped; the serialized-count
-- page holds 200 ids per merchant, so ids are sliced into 200-pages
-- per merchant before that call. The TS client chunks larger sets.
-- Plain CREATE OR REPLACE: the search function is owned by this chain.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_storefront_offer_resolution(
  p_merchant_id uuid,
  p_product_ids uuid[]
)
RETURNS TABLE(
  product_id uuid,
  offer_id uuid,
  condition text,
  price_basis numeric,
  allocatable_stock integer,
  parent_eligible boolean,
  effective_policy text,
  available_units integer,
  compare_at_price numeric,
  grade text,
  condition_notes text,
  images jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Tiered batch caps: an unscoped (NULL merchant) call can span every
  -- merchant, so it is capped at the serialized-count page size; a
  -- merchant-scoped call may address up to 1000 ids (every legitimate
  -- caller batch — carts, catalog pages, blog hydration — is dozens).
  -- The TS client chunks larger sets across invocations.
  IF p_merchant_id IS NULL
    AND COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 200 THEN
    RAISE EXCEPTION
      'get_storefront_offer_resolution supports at most 200 product IDs without a merchant scope (received %)',
      pg_catalog.cardinality(p_product_ids)
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 1000 THEN
    RAISE EXCEPTION
      'get_storefront_offer_resolution supports at most 1000 product IDs (received %)',
      pg_catalog.cardinality(p_product_ids)
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.condition AS parent_condition,
      p.stock, p.stock_quantity, p.inventory_tracking_policy,
      p.has_condition_offers, p.has_variants, p.variant_model,
      (p.has_variants IS TRUE OR COALESCE(p.variant_model, '') = 'sku_matrix') AS variant_bearing,
      CASE WHEN COALESCE(p.stock_quantity, 0) = 0 AND COALESCE(p.stock, 0) > 0
        THEN p.stock ELSE COALESCE(p.stock_quantity, p.stock, 0) END AS parent_effective
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE COALESCE(pg_catalog.cardinality(p_product_ids), 0)
      BETWEEN 1 AND 1000
      AND p.id = ANY(p_product_ids)
      -- A NULL merchant keeps the public-catalog unscoped read (cart
      -- validation prices public data without a merchant session);
      -- published-or-admin gating still applies either way.
      AND (p_merchant_id IS NULL OR p.merchant_id = p_merchant_id)
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  ), anchor_policy AS MATERIALIZED (
    SELECT r.id AS product_id,
      COALESCE(
        (SELECT CASE
           WHEN av.inventory_tracking_policy IN ('off', 'serialized_strict', 'serialized_then_unlimited')
           THEN av.inventory_tracking_policy END
         FROM public.product_variants AS av
         WHERE av.product_id = r.id AND av.merchant_id = r.merchant_id
           AND av.is_inventory_anchor IS TRUE
         ORDER BY av.id LIMIT 1),
        r.inventory_tracking_policy, 'legacy') AS effective_policy,
      -- M28 parent gate, defined once: the final SELECT emits it and
      -- the WHERE enforces it, so gated-out rows never leave the
      -- authority and no consumer can price or stock them.
      (r.has_condition_offers IS TRUE
        AND r.variant_bearing IS NOT TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.product_variants AS nv
          WHERE nv.product_id = r.id
            AND nv.merchant_id = r.merchant_id
            AND nv.is_inventory_anchor IS NOT TRUE
        )) AS parent_eligible
    FROM requested AS r
  -- The serialized-count page holds 200 ids (and rejects the empty
  -- array), so slice each merchant's ids into 200-pages. GROUP BY
  -- never emits an empty page, and the deterministic id order keeps
  -- pages stable across plans.
  -- Only strict products read the serialized counts: merchants with
  -- no strict product skip the call entirely (their result was always
  -- discarded). Kept merchants pass the identical id arrays, so their
  -- results are unchanged — this is a pure call-skipping filter.
  ), strict_merchants AS MATERIALIZED (
    SELECT DISTINCT r.merchant_id
    FROM requested AS r
    JOIN anchor_policy AS a ON a.product_id = r.id
    WHERE a.effective_policy = 'serialized_strict'
  ), merchant_slices AS MATERIALIZED (
    SELECT merchant_id, array_agg(id ORDER BY id) AS ids
    FROM (
      SELECT r2.merchant_id, r2.id,
        (row_number() OVER (PARTITION BY r2.merchant_id ORDER BY r2.id) - 1) / 200 AS slice_no
      FROM requested AS r2
      JOIN strict_merchants AS sm ON sm.merchant_id = r2.merchant_id
    ) AS numbered
    GROUP BY merchant_id, slice_no
  ), serialized AS MATERIALIZED (
    SELECT s.product_id, s.public_available_units
    FROM merchant_slices AS ms
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(
      ms.merchant_id, ms.ids
    ) AS s
    WHERE s.variant_id IS NULL
  )
  SELECT r.id, o.id, o.condition, o.price,
    CASE
      WHEN a.effective_policy = 'serialized_strict'
        THEN LEAST(COALESCE(o.stock_quantity, r.parent_effective), COALESCE(s.public_available_units, 0))
      WHEN a.effective_policy = 'serialized_then_unlimited'
        THEN o.stock_quantity
      ELSE COALESCE(o.stock_quantity, r.parent_effective)
    END AS allocatable_stock,
    a.parent_eligible,
    a.effective_policy,
    CASE WHEN a.effective_policy = 'serialized_strict' THEN s.public_available_units END AS available_units,
    o.compare_at_price, o.grade, o.condition_notes, o.images
  FROM requested AS r
  JOIN anchor_policy AS a ON a.product_id = r.id
  JOIN public.product_offers AS o
    ON o.product_id = r.id AND o.merchant_id = r.merchant_id
  LEFT JOIN serialized AS s ON s.product_id = r.id
  WHERE o.status = 'active'
    -- Gated-out rows are withheld, not flagged: every consumer (cart,
    -- checkout, PDP, native, MCP, blog, search) then treats an
    -- ineligible parent exactly like a missing offer, with no
    -- per-consumer flag check to forget.
    AND a.parent_eligible
  ORDER BY r.id, o.condition, o.id;
END;
$$;

ALTER FUNCTION public.get_storefront_offer_resolution(uuid, uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.get_storefront_offer_resolution(uuid, uuid[]) IS
  'Single offer-resolution authority: live price basis, allocatable stock, and parent eligibility per active condition offer.';

REVOKE ALL ON FUNCTION public.get_storefront_offer_resolution(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_offer_resolution(uuid, uuid[])
  TO anon, authenticated, service_role;

-- The search price-options offer branch now reads the authority instead
-- of restating its rules. Behavior is unchanged for live rows (the
-- scalar is NOT NULL): strict keeps the effective minimum of scalar
-- and units, every other policy keeps the scalar gate, and the parent
-- gate is the same M28 predicate. The advertising-only predicates
-- (same-condition exclusion, 16-row window) stay in this branch.
CREATE OR REPLACE FUNCTION public.get_storefront_search_price_options(p_merchant_id uuid, p_product_id uuid)
RETURNS TABLE(variant_id uuid, offer_id uuid, condition text, effective_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH parent AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.price, p.condition, p.manage_stock,
      p.stock, p.stock_quantity, p.inventory_tracking_policy, p.has_condition_offers, p.has_variants,
      (p.has_variants IS TRUE OR COALESCE(p.variant_model, '') = 'sku_matrix') AS variant_bearing
    FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id
    WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id
      AND p.status = 'active' AND (COALESCE(m.is_published, FALSE) IS TRUE OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
      -- Mirror the PDP snapshot's 128 non-anchor variant cap: products
      -- beyond it are refused wholesale (variants_truncated), so emitting
      -- options here would advertise a card the PDP cannot open. The
      -- capped count stops at 129 rows so pathological catalogs cannot
      -- force a full population scan.
      AND (SELECT COUNT(*) FROM (SELECT 1 FROM public.product_variants v
        WHERE v.product_id = p.id AND v.merchant_id = p.merchant_id
          AND v.is_inventory_anchor IS NOT TRUE LIMIT 129) capped) <= 128
  ), variants AS MATERIALIZED (
    SELECT v.id, v.product_id, v.condition, v.price_override, v.stock_quantity,
      COALESCE(NULLIF(v.inventory_tracking_policy, 'inherit'), NULLIF(p.inventory_tracking_policy, 'inherit'), 'legacy') AS tracking
    FROM parent p JOIN public.product_variants v ON v.product_id = p.id AND v.merchant_id = p.merchant_id
    WHERE v.is_inventory_anchor IS NOT TRUE AND p.variant_bearing IS TRUE
  ), anchor_policy AS MATERIALIZED (
    SELECT p.id AS product_id,
      COALESCE(
        (SELECT CASE
           WHEN av.inventory_tracking_policy IN ('off', 'serialized_strict', 'serialized_then_unlimited')
           THEN av.inventory_tracking_policy END
         FROM public.product_variants av
         WHERE av.product_id = p.id AND av.merchant_id = p.merchant_id
           AND av.is_inventory_anchor IS TRUE
         ORDER BY av.id LIMIT 1),
        p.inventory_tracking_policy, 'legacy') AS effective_policy
    FROM parent p
  ), serialized AS MATERIALIZED (
    SELECT s.variant_id, s.public_available_units FROM parent p
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(p.merchant_id, ARRAY[p.id]) s
    WHERE p.inventory_tracking_policy IN ('serialized_strict', 'serialized_then_unlimited')
       OR EXISTS (SELECT 1 FROM variants v WHERE v.tracking IN ('serialized_strict', 'serialized_then_unlimited'))
       OR EXISTS (SELECT 1 FROM anchor_policy a WHERE a.product_id = p.id AND a.effective_policy IN ('serialized_strict', 'serialized_then_unlimited'))
  ), offers AS MATERIALIZED (
    SELECT r.offer_id AS id, r.condition, r.price_basis AS price, r.allocatable_stock
    FROM parent p
    CROSS JOIN LATERAL public.get_storefront_offer_resolution(p.merchant_id, ARRAY[p.id]) r
    WHERE r.parent_eligible
    -- Mirror the PDP snapshot hydration window exactly (ORDER BY
    -- condition, id LIMIT 16): offers beyond it are unresolvable there,
    -- so advertising one would show a price the PDP cannot honor.
    ORDER BY r.condition, r.offer_id
    LIMIT 16
  )
  SELECT v.id, NULL::uuid, COALESCE(v.condition, p.condition, 'new'), COALESCE(v.price_override, p.price)
  FROM parent p CROSS JOIN variants v
  WHERE v.tracking = 'serialized_then_unlimited'
     OR (v.tracking = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id = v.id AND s.public_available_units > 0))
     OR (v.tracking NOT IN ('serialized_strict', 'serialized_then_unlimited')
         AND (p.manage_stock IS FALSE OR COALESCE(v.stock_quantity, CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END) > 0))
  UNION ALL
  SELECT NULL::uuid, o.id, o.condition, o.price FROM parent p CROSS JOIN offers o
  WHERE p.variant_bearing IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants) AND
        -- Same-condition offers are unresolvable: the categorized PDP drops
        -- any offer whose normalized condition equals the parent's, so
        -- emitting one here advertises a price + offer_id the PDP cannot
        -- honor. Normalization mirrors normalizeCanonicalProductCondition.
        storefront_search_private.normalize_condition_for_match(o.condition) IS NOT NULL AND
        storefront_search_private.normalize_condition_for_match(o.condition)
          IS DISTINCT FROM storefront_search_private.normalize_condition_for_match(p.condition) AND
        -- Allocatable stock comes from the authority (effective minimum
        -- under strict, scalar otherwise); NULL is unbounded (unlimited
        -- policy with no scalar). Unlike the base and variant branches,
        -- an offer scalar of zero stays unadvertised even on unmanaged
        -- parents: the PDP, the native cart, and order creation all honor
        -- a finite offer quantity as the binding allocation there, so
        -- emitting it would advertise an option checkout refuses.
        (o.allocatable_stock IS NULL OR o.allocatable_stock > 0)
  UNION ALL
  SELECT NULL::uuid, NULL::uuid, COALESCE(p.condition, 'new'), p.price FROM parent p JOIN anchor_policy a ON a.product_id = p.id
  WHERE p.variant_bearing IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants)
    AND (a.effective_policy = 'serialized_then_unlimited'
      OR (a.effective_policy = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id IS NULL AND s.public_available_units > 0))
      OR (a.effective_policy NOT IN ('serialized_strict', 'serialized_then_unlimited')
        AND (p.manage_stock IS FALSE OR CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END > 0)));
$$;

COMMIT;
