-- Append-only: gate the search offers branch on strict serialized units.
--
-- The offers branch of get_storefront_search_price_options resolved
-- availability from the offer scalar alone, so a serialized_strict
-- simple product with zero available units still emitted purchasable
-- offer options while the base branch (anchor effective policy)
-- correctly refused. The PDP and native cart read the offer scalar for
-- serialized offers, so the mismatch advertised an option the PDP
-- cannot honor. The branch now joins anchor_policy and mirrors the
-- base branch: serialized_then_unlimited passes, serialized_strict
-- requires base available units > 0 plus the offer scalar gate
-- (effective minimum — a merchant-zeroed offer stays unadvertised even
-- when base units exist), and other policies keep the scalar gate
-- unchanged. Plain CREATE OR REPLACE: the function is owned by this
-- PR's migration chain, so no definition string-patch is needed.
BEGIN;

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
    SELECT o.id, o.condition, o.price, o.stock_quantity
    FROM parent p JOIN public.product_offers o ON o.product_id = p.id AND o.merchant_id = p.merchant_id
    WHERE p.has_condition_offers IS TRUE AND o.status = 'active'
    -- Mirror the PDP snapshot hydration window exactly (ORDER BY
    -- condition, id LIMIT 16): offers beyond it are unresolvable there,
    -- so advertising one would show a price the PDP cannot honor.
    ORDER BY o.condition, o.id
    LIMIT 16
  )
  SELECT v.id, NULL::uuid, COALESCE(v.condition, p.condition, 'new'), COALESCE(v.price_override, p.price)
  FROM parent p CROSS JOIN variants v
  WHERE v.tracking = 'serialized_then_unlimited'
     OR (v.tracking = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id = v.id AND s.public_available_units > 0))
     OR (v.tracking NOT IN ('serialized_strict', 'serialized_then_unlimited')
         AND (p.manage_stock IS FALSE OR COALESCE(v.stock_quantity, CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END) > 0))
  UNION ALL
  SELECT NULL::uuid, o.id, o.condition, o.price FROM parent p CROSS JOIN offers o JOIN anchor_policy a ON a.product_id = p.id
  WHERE p.variant_bearing IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants) AND
        -- Same-condition offers are unresolvable: the categorized PDP drops
        -- any offer whose normalized condition equals the parent's, so
        -- emitting one here advertises a price + offer_id the PDP cannot
        -- honor. Normalization mirrors normalizeCanonicalProductCondition.
        storefront_search_private.normalize_condition_for_match(o.condition) IS NOT NULL AND
        storefront_search_private.normalize_condition_for_match(o.condition)
          IS DISTINCT FROM storefront_search_private.normalize_condition_for_match(p.condition) AND
        -- Mirror the base branch's anchor-policy gate: strict offers need
        -- base available units plus the offer scalar (effective minimum),
        -- unlimited passes, other policies keep the scalar gate.
        (a.effective_policy = 'serialized_then_unlimited'
          OR (((a.effective_policy = 'serialized_strict'
                AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id IS NULL AND s.public_available_units > 0))
               OR a.effective_policy NOT IN ('serialized_strict', 'serialized_then_unlimited'))
              AND (p.manage_stock IS FALSE OR COALESCE(o.stock_quantity, CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END) > 0)))
  UNION ALL
  SELECT NULL::uuid, NULL::uuid, COALESCE(p.condition, 'new'), p.price FROM parent p JOIN anchor_policy a ON a.product_id = p.id
  WHERE p.variant_bearing IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants)
    AND (a.effective_policy = 'serialized_then_unlimited'
      OR (a.effective_policy = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id IS NULL AND s.public_available_units > 0))
      OR (a.effective_policy NOT IN ('serialized_strict', 'serialized_then_unlimited')
        AND (p.manage_stock IS FALSE OR CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END > 0)));
$$;

COMMIT;
