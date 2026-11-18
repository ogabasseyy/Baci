-- ============================================================================
-- Negotiation cost floor RPC (stage 1 of the products.cost_price containment)
-- ============================================================================
-- POST /api/storefront/negotiate used to read products.cost_price with the
-- shopper's own (anon / authenticated) client to compute the auto-accept floor.
-- Stage 2 (20261110090100_revoke_products_cost_price_anon.sql) removes anon's
-- right to read cost_price, so the floor is computed here, inside the database,
-- and only the resulting floor price is returned.
--
-- This migration is purely additive and safe to apply before any code change.
-- Ship the route change that calls this RPC BEFORE applying stage 2.
--
-- Disclosure: the function returns GREATEST(cost * 1.1, price * 0.98) for an
-- active product. When the 2% auto-negotiation cap dominates (about 77% of
-- costed products) the value is just price * 0.98 and carries no information
-- about cost. When cost dominates it equals what the route already tells the
-- shopper as the "best price" counter offer, but one direct call returns it
-- exactly (the route needed several offers to find it), and the function has no
-- brand/negotiability gate, so for non-negotiable products it also discloses a
-- floor the route never would. Residual, tracked as a follow-up: an
-- offer-evaluation RPC returning only accept/counter/final, plus rate limiting.
-- The 1.1 margin and 0.98 cap are fixed here on purpose: taking them as
-- parameters would let a caller solve for cost.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_negotiation_cost_floor_price(
  p_product_id uuid,
  p_merchant_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT GREATEST(
    COALESCE(NULLIF(p.cost_price, 0), p.price * 0.6) * 1.1,
    p.price * 0.98
  )
  FROM public.products p
  WHERE p.id = p_product_id
    AND p.merchant_id = p_merchant_id
    AND p.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_negotiation_cost_floor_price(uuid, uuid) IS
  'Lowest auto-acceptable negotiated price for an active product. Computed from products.cost_price without exposing it.';
