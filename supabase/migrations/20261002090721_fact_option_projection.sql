-- Condition matching shares recall/hydration's canonical public variant set.
CREATE OR REPLACE FUNCTION discovery.product_condition_option_matches(
  p_product_id uuid,
  p_has_variants boolean,
  p_base_condition text,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH purchasable_variants AS (
    SELECT option_row.condition
    FROM public.products AS p
    CROSS JOIN LATERAL discovery.public_variant_option_projection(
      p.merchant_id, ARRAY[p_product_id]) AS option_row
    WHERE p.id = p_product_id
      AND option_row.is_purchasable IS TRUE
  )
  SELECT EXISTS (SELECT 1 FROM purchasable_variants AS pv
      WHERE coalesce(discovery.canonical_product_condition(pv.condition),
        p_base_condition) = p_condition)
  OR (discovery.condition_offer_selectable(p_product_id, p_has_variants,
      p_condition, p_manage_stock)
    AND (COALESCE(p_has_variants, FALSE) IS NOT TRUE
      OR EXISTS (SELECT 1 FROM purchasable_variants)));
$$;

ALTER FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) IS
  'Condition option predicate over publicly scoped purchasable variants and selectable offers.';
