-- Private agent controls are available only through server-minted, slug-bound authority.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentic_merchant_context') THEN
    CREATE ROLE agentic_merchant_context NOLOGIN;
  END IF;
END $roles$;
GRANT agentic_merchant_context TO authenticator;
GRANT USAGE ON SCHEMA public TO agentic_merchant_context;

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
  agent_allowlist jsonb,
  agent_denylist jsonb
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
    NULL::text AS paystack_subaccount_code,
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
    fs.custom_settings -> 'agentic_agent_allowlist' AS agent_allowlist,
    fs.custom_settings -> 'agentic_agent_denylist' AS agent_denylist
  FROM public.merchants AS m
  LEFT JOIN public.merchant_feature_settings AS fs
    ON fs.merchant_id = m.id
  WHERE auth.jwt()->>'role' = 'agentic_merchant_context'
    AND auth.jwt()->>'agentic_merchant_slug' = lower(trim(p_slug))
    AND p_slug IS NOT NULL
    AND octet_length(p_slug) <= 254
    AND m.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_agentic_merchant_context(text) IS
  'Returns the minimal agentic merchant-context projection (identity, primary domain, checkout flags, agent allow/deny lists) for the configured merchant slug so UCP cart routes never resolve merchants with a service-role client. Paystack subaccount code is intentionally not disclosed.';

ALTER FUNCTION public.resolve_agentic_merchant_context(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_agentic_merchant_context(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_agentic_merchant_context(text)
  TO agentic_merchant_context;
