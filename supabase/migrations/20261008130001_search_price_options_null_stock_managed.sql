-- Append-only: align NULL manage_stock with the categorized-PDP null policy.
--
-- 20261004151000 treated NULL stock tracking as unmanaged (IS NOT TRUE),
-- claiming to match both PDPs — but the categorized PDP normalizes legacy
-- NULL manage_stock to MANAGED inventory
-- (category-product-detail-resolution.ts), and the shared
-- isPublicVariantPurchasable helper documents that as the platform policy
-- ("a depleted child under a null parent is unavailable everywhere").
-- The mismatch let search advertise an exact price/variant that the PDP
-- then showed as unavailable. Only an explicit FALSE now bypasses the
-- stock checks; NULL rows must carry stock like any managed product.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_storefront_search_price_options(p_merchant_id uuid, p_product_id uuid)
RETURNS TABLE(variant_id uuid, offer_id uuid, condition text, effective_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH parent AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.price, p.condition, p.manage_stock,
      p.stock, p.stock_quantity, p.inventory_tracking_policy, p.has_condition_offers, p.has_variants
    FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id
    WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id
      AND p.status = 'active' AND m.is_published IS TRUE
  ), variants AS MATERIALIZED (
    SELECT v.id, v.product_id, v.condition, v.price_override, v.stock_quantity,
      COALESCE(NULLIF(v.inventory_tracking_policy, 'inherit'), NULLIF(p.inventory_tracking_policy, 'inherit'), 'legacy') AS tracking
    FROM parent p JOIN public.product_variants v ON v.product_id = p.id AND v.merchant_id = p.merchant_id
    WHERE v.is_inventory_anchor IS NOT TRUE AND p.has_variants IS TRUE
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
  )
  SELECT v.id, NULL::uuid, COALESCE(v.condition, p.condition, 'new'), COALESCE(v.price_override, p.price)
  FROM parent p CROSS JOIN variants v
  WHERE v.tracking = 'serialized_then_unlimited'
     OR (v.tracking = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id = v.id AND s.public_available_units > 0))
     OR (v.tracking NOT IN ('serialized_strict', 'serialized_then_unlimited')
         AND (p.manage_stock IS FALSE OR COALESCE(v.stock_quantity, CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END) > 0))
  UNION ALL
  SELECT NULL::uuid, o.id, o.condition, o.price FROM parent p CROSS JOIN offers o
  WHERE p.has_variants IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants) AND (p.manage_stock IS FALSE OR COALESCE(o.stock_quantity, 0) > 0)
  UNION ALL
  SELECT NULL::uuid, NULL::uuid, COALESCE(p.condition, 'new'), p.price FROM parent p JOIN anchor_policy a ON a.product_id = p.id
  WHERE p.has_variants IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM variants)
    AND (a.effective_policy = 'serialized_then_unlimited'
      OR (a.effective_policy = 'serialized_strict' AND EXISTS (SELECT 1 FROM serialized s WHERE s.variant_id IS NULL AND s.public_available_units > 0))
      OR (a.effective_policy NOT IN ('serialized_strict', 'serialized_then_unlimited')
        AND (p.manage_stock IS FALSE OR CASE WHEN COALESCE(p.stock_quantity,0)=0 AND COALESCE(p.stock,0)>0 THEN p.stock ELSE COALESCE(p.stock_quantity,p.stock,0) END > 0)));
$$;

COMMIT;
