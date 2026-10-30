-- Checkout completion needs the configured merchant's Paystack payment split.
-- The shared context projection keeps withholding it because cart routes never
-- need it. This function returns only that value, under the same server-minted,
-- slug-bound agentic_merchant_context authority.
CREATE OR REPLACE FUNCTION public.resolve_agentic_merchant_payment_split(
  p_slug text
)
RETURNS TABLE (
  paystack_subaccount_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT m.paystack_subaccount_code::text AS paystack_subaccount_code
  FROM public.merchants AS m
  WHERE auth.jwt()->>'role' = 'agentic_merchant_context'
    AND auth.jwt()->>'agentic_merchant_slug' = lower(trim(p_slug))
    AND p_slug IS NOT NULL
    AND octet_length(p_slug) <= 254
    AND m.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_agentic_merchant_payment_split(text) IS
  'Returns only the configured agentic merchant''s Paystack subaccount code for checkout completion, under the server-minted, slug-bound agentic_merchant_context authority.';

ALTER FUNCTION public.resolve_agentic_merchant_payment_split(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_agentic_merchant_payment_split(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_agentic_merchant_payment_split(text)
  TO agentic_merchant_context;
