-- Replace the reversible cost * 1.1 result introduced by stage 1 (#4158).
-- Only fixed, publicly known list-price tiers leave the database. This preserves
-- the private margin guard without providing a continuous cost oracle. Callers
-- may still infer a coarse cost interval from discount eligibility, as with the
-- existing Santa catalog. Never add a caller-supplied rate, offer or multiplier.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_negotiation_cost_floor_price(
  p_product_id uuid,
  p_merchant_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT MIN(ceil(p.price * tier.rate))
      FROM (VALUES (0.98::numeric), (0.985::numeric), (0.99::numeric)) AS tier(rate)
      WHERE ceil(p.price * tier.rate) < p.price
        AND ceil(p.price * tier.rate) >=
          COALESCE(NULLIF(p.cost_price, 0), p.price * 0.6) * 1.1
    ),
    p.price
  )
  FROM public.products AS p
  WHERE p.id = p_product_id
    AND p.merchant_id = p_merchant_id
    AND p.status = 'active'
    AND p.price > 0;
$$;
REVOKE EXECUTE ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid) IS
  'Lowest allowed fixed public-price negotiation tier, or the list price. Never returns a continuous cost-derived price; discount eligibility reveals only a coarse interval.';
COMMIT;
