-- Shared pre-cap offer gate for condition narrowing (recall and browse).
-- Mirrors the selector exactly: an offer satisfies the requested canonical
-- condition only when it is active (the public offer projection and the PDP
-- expose active rows only) and the product's variants do not own condition
-- selection (any non-anchor variant with a canonicalizable condition
-- disables offers entirely, per variantsOwnConditionAxis). Bare offers on a
-- managed product additionally need positive offer stock, mirroring
-- rejectBareOfferStock: the PDP replaces paired-offer stock with the
-- selected variant's stock, so paired products keep the existing behavior
-- (variant purchasability stays unmodeled). The three-argument form stays
-- until the recall, browse, and fact callers move over, then .27 drops it.
CREATE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.product_offers AS o
    WHERE o.product_id = p_product_id
      AND o.status = 'active'
      AND discovery.canonical_product_condition(o.condition) = p_condition
      AND (COALESCE(p_has_variants, FALSE)
        OR p_manage_stock IS NOT TRUE
        OR COALESCE(o.stock_quantity, 0) > 0))
  AND NOT (COALESCE(p_has_variants, FALSE)
    AND EXISTS (SELECT 1 FROM public.product_variants AS v2
      WHERE v2.product_id = p_product_id
        AND v2.is_inventory_anchor IS NOT TRUE
        AND discovery.canonical_product_condition(v2.condition) IS NOT NULL));
$$;

-- Fact-retrieval variant/offer leg with the parent stock-management state
-- threaded through to the offer gate. The four-argument form stays until
-- the facts RPC moves over, then .27 drops it.
CREATE FUNCTION discovery.product_condition_option_matches(
  p_product_id uuid,
  p_has_variants boolean,
  p_base_condition text,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.product_variants AS v
    WHERE v.product_id = p_product_id
      AND v.is_inventory_anchor IS NOT TRUE
      AND coalesce(discovery.canonical_product_condition(v.condition),
        p_base_condition) = p_condition)
  OR discovery.condition_offer_selectable(p_product_id, p_has_variants,
    p_condition, p_manage_stock);
$$;
