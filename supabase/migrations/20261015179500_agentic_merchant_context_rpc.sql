-- Narrowly scoped merchant-context boundary for the agentic (UCP) cart
-- call graph: the user-facing cart routes must not construct a
-- service-role client just to resolve the configured merchant. This
-- SECURITY DEFINER function returns only the projection the agentic
-- merchant context consumes, keyed by the configured merchant slug.
CREATE OR REPLACE FUNCTION public.resolve_agentic_merchant_context(
  p_slug text
)
RETURNS TABLE (
  id uuid,
  slug text,
  business_name text,
  paystack_subaccount_code text,
  custom_domain text,
  agentic_checkout_enabled boolean,
  pay_on_delivery_enabled boolean,
  custom_settings jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    m.id,
    m.slug::text AS slug,
    m.business_name::text AS business_name,
    m.paystack_subaccount_code::text AS paystack_subaccount_code,
    (
      SELECT d.domain::text
      FROM public.domains AS d
      WHERE d.merchant_id = m.id
        AND d.is_primary
        AND d.status = 'active'
      ORDER BY
        d.updated_at DESC NULLS LAST,
        d.created_at DESC NULLS LAST,
        d.id
      LIMIT 1
    ) AS custom_domain,
    COALESCE(fs.agentic_checkout_enabled, true) AS agentic_checkout_enabled,
    COALESCE(fs.pay_on_delivery_enabled, false) AS pay_on_delivery_enabled,
    fs.custom_settings
  FROM public.merchants AS m
  LEFT JOIN public.merchant_feature_settings AS fs
    ON fs.merchant_id = m.id
  WHERE p_slug IS NOT NULL
    AND octet_length(p_slug) <= 254
    AND m.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_agentic_merchant_context(text) IS
  'Returns the minimal agentic merchant-context projection for the configured merchant slug so UCP cart routes never resolve merchants with a service-role client.';

REVOKE ALL ON FUNCTION public.resolve_agentic_merchant_context(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_agentic_merchant_context(text)
  TO anon, authenticated, service_role;
