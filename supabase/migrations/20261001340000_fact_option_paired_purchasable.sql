-- Paired offers require a purchasable variant in the option gate. Variant
-- products pair an offer only when a purchasable variant exists (the PDP
-- blocks add-to-cart without one), but the offer branch admitted on the
-- offer alone, so fully depleted variant products consumed the capped
-- windows. Purchasable variants now resolve once per product under the
-- effective policy and stock rules; the variant leg matches conditions
-- within that set and the offer leg requires it for variant products.
-- Same five-argument signature: CREATE OR REPLACE, no drop.
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
  WITH parent AS (
    SELECT p.merchant_id, p.manage_stock, p.inventory_tracking_policy
    FROM public.products AS p
    WHERE p.id = p_product_id
  ),
  merchant_branches AS (
    SELECT count(*)::integer AS branch_count, (array_agg(b.id))[1] AS only_branch_id
    FROM public.branches AS b
    WHERE b.merchant_id = (SELECT parent.merchant_id FROM parent)
      AND b.active = true
  ),
  purchasable_variants AS (
    SELECT v.id, v.condition
    FROM public.product_variants AS v
    CROSS JOIN parent AS parent
    CROSS JOIN merchant_branches AS mb
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(v.inventory_tracking_policy, 'inherit') IN ('off', 'serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(v.inventory_tracking_policy, 'inherit')
        WHEN COALESCE(parent.inventory_tracking_policy, 'off') IN ('serialized_strict', 'serialized_then_unlimited')
          THEN parent.inventory_tracking_policy
        ELSE 'off'
      END AS effective_policy
    ) AS policy
    WHERE v.product_id = p_product_id
      AND v.is_inventory_anchor IS NOT TRUE
      AND (policy.effective_policy = 'serialized_then_unlimited'
        OR (policy.effective_policy = 'off'
          AND (parent.manage_stock IS FALSE OR v.stock_quantity > 0))
        OR (policy.effective_policy = 'serialized_strict'
          AND EXISTS (SELECT 1 FROM public.variant_inventory AS vi
            WHERE vi.variant_id = v.id
              AND vi.merchant_id = parent.merchant_id
              AND vi.status = 'available'
              AND vi.order_id IS NULL
              AND vi.order_item_id IS NULL
              AND vi.sold_at IS NULL
              AND ((mb.branch_count = 1
                  AND (vi.branch_id = mb.only_branch_id OR vi.branch_id IS NULL))
                OR (mb.branch_count IS DISTINCT FROM 1 AND vi.branch_id IS NULL)))))
  )
  SELECT EXISTS (SELECT 1 FROM purchasable_variants AS pv
      WHERE coalesce(discovery.canonical_product_condition(pv.condition),
        p_base_condition) = p_condition)
  OR (discovery.condition_offer_selectable(p_product_id, p_has_variants,
      p_condition, p_manage_stock)
    AND (COALESCE(p_has_variants, FALSE) IS NOT TRUE
      OR EXISTS (SELECT 1 FROM purchasable_variants)));
$$;
