-- Restore NULL-manage restriction on the base option helper. The prior
-- revision admitted NULL manage_stock (IS NOT TRUE) for MCP-hydration
-- parity, but the categorized PDP normalizes legacy NULL to managed
-- inventory, and the canonical variant helper
-- (isPublicVariantPurchasable) matches it: only an ABSENT policy
-- (undefined, unprojected data) stays fail-open. A NULL-manage
-- depleted non-serialized base is therefore unpurchasable, and the
-- publication-bounds suite pins it. Only explicit FALSE permits
-- purchasing a depleted base. Same signature: CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION discovery.base_product_option_is_purchasable(
  p_product_id uuid,
  p_merchant_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    LEFT JOIN LATERAL (
      SELECT anchor.effective_policy, anchor.available_units
      FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], p_merchant_id) AS anchor
      LIMIT 1
    ) AS serialized ON TRUE
    WHERE p.id = p_product_id
      AND p.merchant_id = p_merchant_id
      AND p.has_variants IS NOT TRUE
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
      AND (
        COALESCE(serialized.effective_policy, 'off') = 'serialized_then_unlimited'
        OR (serialized.effective_policy = 'serialized_strict'
          AND COALESCE(serialized.available_units, 0) > 0)
        OR (serialized.effective_policy IS NULL
          AND (p.manage_stock IS FALSE OR COALESCE(p.stock_quantity, 0) > 0))
      )
  );
$$;
ALTER FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) IS
  'Base option purchasability using the canonical serialized anchor projection and parent stock fallback.';
