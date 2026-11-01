-- Internal aggregate for the branch-specific PDP snapshot. Identifiers remain
-- private; only the count is emitted to storefront clients.
CREATE OR REPLACE FUNCTION private.get_serialized_offer_available_units(
  p_merchant_id uuid, p_product_id uuid, p_offer_id uuid, p_branch_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH branch_scope AS (
    SELECT count(*)::integer AS active_count, (array_agg(b.id))[1] AS only_branch_id,
      bool_or(b.id = p_branch_id) AS branch_valid
    FROM public.branches AS b
    WHERE b.merchant_id = p_merchant_id AND b.active IS TRUE
  )
  SELECT count(vi.id)::integer
  FROM public.merchants AS m
  JOIN public.products AS p ON p.merchant_id = m.id AND p.id = p_product_id AND p.status = 'active'
  JOIN public.product_offers AS o ON o.merchant_id = p.merchant_id AND o.product_id = p.id AND o.id = p_offer_id AND o.status = 'active'
  JOIN LATERAL (
    SELECT pv.id FROM public.product_variants AS pv
    WHERE pv.id = p.inventory_anchor_variant_id AND pv.product_id = p.id
      AND pv.merchant_id = p.merchant_id AND pv.is_inventory_anchor IS TRUE
  ) AS anchor ON true
  JOIN public.variant_inventory AS vi ON vi.variant_id = anchor.id AND vi.merchant_id = p.merchant_id
    AND vi.condition_offer_id = o.id AND vi.status = 'available'
    AND vi.order_id IS NULL AND vi.order_item_id IS NULL AND vi.sold_at IS NULL
  CROSS JOIN branch_scope AS bs
  WHERE m.id = p_merchant_id AND (coalesce(m.is_published, false) OR coalesce(m.is_platform_admin, false))
    AND CASE WHEN p_branch_id IS NOT NULL THEN
      coalesce(bs.branch_valid, false) AND (vi.branch_id IS NULL OR vi.branch_id = p_branch_id)
    ELSE vi.branch_id IS NULL OR (bs.active_count = 1 AND vi.branch_id = bs.only_branch_id) END;
$$;
REVOKE ALL ON FUNCTION private.get_serialized_offer_available_units(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
