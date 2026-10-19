-- Shared pre-cap offer gate for condition narrowing (recall and browse).
-- Mirrors the selector exactly: an offer satisfies the requested canonical
-- condition only when it is active (the public offer projection and the PDP
-- expose active rows only) and the product's variants do not own condition
-- selection (any non-anchor variant with a canonicalizable condition
-- disables offers entirely, per variantsOwnConditionAxis).
CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.product_offers AS o
    WHERE o.product_id = p_product_id
      AND o.status = 'active'
      AND discovery.canonical_product_condition(o.condition) = p_condition)
  AND NOT (COALESCE(p_has_variants, FALSE)
    AND EXISTS (SELECT 1 FROM public.product_variants AS v2
      WHERE v2.product_id = p_product_id
        AND v2.is_inventory_anchor IS NOT TRUE
        AND discovery.canonical_product_condition(v2.condition) IS NOT NULL));
$$;
