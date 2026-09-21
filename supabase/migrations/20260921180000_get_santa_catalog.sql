-- Santa chat needs margin-aware offers without exposing products.cost_price to
-- anonymous catalog reads or to the model. This narrow, published-storefront
-- projection returns only the public fields needed to construct the prompt.
CREATE OR REPLACE FUNCTION public.get_santa_catalog(p_merchant_id uuid)
RETURNS TABLE (
  brand text,
  name text,
  price numeric,
  max_margin_discount_percentage integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.brand,
    p.name,
    p.price,
    CASE
      -- An invalid selling price must never create a discount authority.
      WHEN p.price IS NULL OR p.price <= 0 THEN 0
      -- Preserve the existing margin floor without returning the private cost.
      WHEN p.cost_price IS NULL OR p.cost_price <= 0 THEN 2
      ELSE GREATEST(
        0,
        LEAST(
          2,
          FLOOR(((p.price - p.cost_price - 10000) / p.price) * 100)::integer
        )
      )
    END AS max_margin_discount_percentage
  FROM public.products AS p
  INNER JOIN public.merchants AS m ON m.id = p.merchant_id
  WHERE p.merchant_id = p_merchant_id
    AND p.status = 'active'
    AND m.is_published IS TRUE
  ORDER BY p.price DESC
  LIMIT 5000;
$$;

ALTER FUNCTION public.get_santa_catalog(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_santa_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_santa_catalog(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_santa_catalog(uuid) IS
  'Published Santa catalog projection with checkout-capped margin-derived discount ceilings; never returns product cost prices.';

-- Preserve campaign analytics without the former service-role write or an
-- anonymous RPC. Only a short-lived server-signed checkout context can insert
-- a bounded event for its own configured merchant and session.
DROP POLICY IF EXISTS "Agentic Santa interactions are insertable by scoped client"
  ON public.santa_interactions;
CREATE POLICY "Agentic Santa interactions are insertable by scoped client"
  ON public.santa_interactions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_agentic_checkout_context()
    AND merchant_id = public.current_agentic_merchant_id()
    AND session_id = public.current_agentic_session_id()
    AND interaction_type IN ('chat', 'wish_granted', 'wish_denied')
    AND order_id IS NULL
    AND char_length(session_id) BETWEEN 1 AND 128
    AND (client_ip IS NULL OR char_length(client_ip) <= 64)
    AND (product_name IS NULL OR char_length(product_name) <= 200)
    AND (user_message IS NULL OR char_length(user_message) <= 500)
    AND (santa_response IS NULL OR char_length(santa_response) <= 1000)
  );
