-- Restore the windowed first-row offer gate inside the hardened
-- condition helper. The hardening revision kept publication, stored-row
-- resolution, and the variant-ownership exclusion but replaced the
-- offer match with an unbounded any-match EXISTS, so a shadowed
-- product whose ordered-first canonical offer is depleted still
-- matches through a later stocked duplicate (recall admits the
-- shadowed twin). Selection hydrates only the first 16 active offers
-- ordered by (condition, id) and claims each canonical condition on
-- its first matching row, so the gate must mirror resolvability
-- exactly: paired and unmanaged products keep any-match behavior
-- within the window, while a managed bare product requires its first
-- canonical match to carry positive stock. Stored-row resolution,
-- DEFINER execution, and grants are unchanged. Same four-argument
-- signature: CREATE OR REPLACE, no drop.
CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH stored AS (
    SELECT p.has_variants, p.manage_stock
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p.id = p_product_id
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  ),
  windowed AS (
    SELECT o.id, o.condition, o.stock_quantity
    FROM stored AS s
    JOIN public.product_offers AS o
      ON o.product_id = p_product_id AND o.status = 'active'
    ORDER BY o.condition, o.id LIMIT 16
  ),
  first_match AS (
    SELECT w.stock_quantity
    FROM windowed AS w
    WHERE discovery.canonical_product_condition(w.condition) = p_condition
    ORDER BY w.condition, w.id LIMIT 1
  )
  SELECT (EXISTS (SELECT 1 FROM windowed AS w
      WHERE discovery.canonical_product_condition(w.condition) = p_condition)
    AND EXISTS (SELECT 1 FROM stored AS s
      WHERE COALESCE(s.has_variants, FALSE) OR s.manage_stock IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM first_match AS f
      WHERE COALESCE(f.stock_quantity, 0) > 0))
  AND NOT (EXISTS (SELECT 1 FROM stored AS s WHERE s.has_variants IS TRUE)
    AND EXISTS (SELECT 1 FROM public.product_variants AS v
      WHERE v.product_id = p_product_id
        AND v.is_inventory_anchor IS NOT TRUE
        AND discovery.canonical_product_condition(v.condition) IS NOT NULL));
$$;

ALTER FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) IS
  'Checks only published active products and their first 16 ordered active offers; stored product fields override caller hints.';
