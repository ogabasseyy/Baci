-- Expose only the published merchant origin fields needed for mobile carrier
-- quotes. The mobile storefront posts a merchant UUID in the request body and
-- cannot carry the trusted storefront host headers used by web checkout. This
-- SECURITY DEFINER projection keeps the base merchants table private while
-- preventing that body-only flow from silently pricing every origin as Lagos.
CREATE OR REPLACE FUNCTION public.get_storefront_shipping_sender(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN COALESCE(m.is_published, false) THEN jsonb_build_object(
          'business_name', m.business_name,
          'business_address', m.business_address,
          'phone', m.phone,
          'country', m.country,
          'state_code', m.state_code
        )
        ELSE '{}'::jsonb
      END
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
    ),
    '{}'::jsonb
  );
$$;

COMMENT ON FUNCTION public.get_storefront_shipping_sender(uuid) IS
  'Returns the published merchant origin projection required to price mobile storefront carrier quotes; base merchant rows remain private.';

REVOKE ALL ON FUNCTION public.get_storefront_shipping_sender(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_shipping_sender(uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
