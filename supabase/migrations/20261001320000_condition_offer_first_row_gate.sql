-- First-row offer gate for condition narrowing. Selection claims each
-- canonical condition on the hydration projection's first matching row
-- with no stock check (PDP parity) and drops it on stock instead of
-- surfacing a later stocked duplicate, so admitting on any-match stocked
-- rows lets shadowed products consume the capped windows. The gate now
-- mirrors resolvability exactly: only the first 16 active offers ordered
-- by (condition, id) hydrate, and the first canonical match within that
-- window must carry positive stock on managed bare products. Paired and
-- unmanaged products keep the existing any-match behavior (their selection
-- skips the stock rejection), still scoped to the hydrated window. Same
-- four-argument signature: CREATE OR REPLACE, no drop.
CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH windowed AS (
    SELECT o.id, o.condition, o.stock_quantity
    FROM public.product_offers AS o
    WHERE o.product_id = p_product_id AND o.status = 'active'
    ORDER BY o.condition, o.id LIMIT 16
  ),
  first_match AS (
    SELECT w.id, w.stock_quantity
    FROM windowed AS w
    WHERE discovery.canonical_product_condition(w.condition) = p_condition
    ORDER BY w.condition, w.id LIMIT 1
  )
  SELECT (EXISTS (SELECT 1 FROM windowed AS w
      WHERE discovery.canonical_product_condition(w.condition) = p_condition)
    AND (COALESCE(p_has_variants, FALSE) OR p_manage_stock IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM first_match AS f
      WHERE COALESCE(f.stock_quantity, 0) > 0))
  AND NOT (COALESCE(p_has_variants, FALSE)
    AND EXISTS (SELECT 1 FROM public.product_variants AS v2
      WHERE v2.product_id = p_product_id
        AND v2.is_inventory_anchor IS NOT TRUE
        AND discovery.canonical_product_condition(v2.condition) IS NOT NULL));
$$;
