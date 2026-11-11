-- ============================================================================
-- Cart negotiation: never auto-accept a price under the merchant cost floor
-- ============================================================================
-- commerce_cart_negotiation_auto_accepts only checked the 2% discount band, so
-- a negotiable product whose cost is within ~12% of its price could be sold at
-- or below cost (measured 2026-11-10: 75 sellable products would sell at or
-- below cost after a 2% discount; 58 have cost above price).
--
-- Adds the cost check by reusing public.get_negotiation_cost_floor_price
-- (20261110090000), the single sanctioned way to use products.cost_price
-- without reading it. That function returns GREATEST(cost * 1.1, price * 0.98).
-- The 2% band is already enforced below, so the floor only matters when the
-- cost term dominates (floor > price * 0.98). Then:
--   * a negotiated price under the floor is not auto-accepted (status stays
--     'pending', so it never changes the charged price);
--   * a product whose cost * 1.1 exceeds its price therefore accepts no
--     discount at all;
--   * a full-price line (negotiated >= catalog) is untouched: it already
--     returns false here and is charged the catalog price as before;
--   * a product without a usable cost is unaffected (the function falls back
--     to price * 0.6, which never dominates).
-- An inactive/unknown product has no floor: no discount is accepted.
--
-- Known gap: the floor is product-level; a variant's own cost_price is not
-- consulted (no sanctioned variant-cost function exists yet).
--
-- Full function body (signature, zero-price handling and 2% band as installed
-- by 20261015130000 + 20261015179910); no source patching.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commerce_cart_negotiation_auto_accepts(
  p_merchant_id uuid, p_product_id uuid, p_variant_id uuid, p_negotiated bigint
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_catalog bigint;
  v_parent_price numeric;
  v_floor numeric;
BEGIN
  IF p_negotiated IS NULL THEN RETURN false; END IF;
  v_catalog := public.commerce_cart_offer_price_minor(p_merchant_id, p_product_id, p_variant_id);
  IF v_catalog <= 0 OR p_negotiated < 0 OR p_negotiated >= v_catalog THEN
    RETURN false;
  END IF;
  IF NOT public.commerce_cart_product_negotiable(p_merchant_id, p_product_id) THEN
    RETURN false;
  END IF;

  SELECT p.price INTO v_parent_price
  FROM public.products p
  WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id;
  v_floor := public.get_negotiation_cost_floor_price(p_product_id, p_merchant_id);
  IF v_floor IS NULL OR v_parent_price IS NULL THEN
    RETURN false;
  END IF;
  -- Cost dominates the floor: the discount must keep the 10% margin (kobo).
  IF v_floor > v_parent_price * 0.98 AND p_negotiated::numeric < v_floor * 100 THEN
    RETURN false;
  END IF;

  RETURN (v_catalog - p_negotiated)::bigint * 100 <= v_catalog::bigint * 2;
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; they are intentionally unchanged.
