CREATE OR REPLACE FUNCTION public.get_storefront_redvault_live_pilot_policy()
RETURNS TABLE(enabled boolean,audience text,merchant_id uuid,product_id uuid,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT policy.enabled,policy.audience,policy.merchant_id,policy.product_id,policy.expires_at
  FROM private.uba_redvault_live_pilot_policy policy
  WHERE policy.singleton
    AND policy.merchant_id='6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid;
$$;
ALTER FUNCTION public.get_storefront_redvault_live_pilot_policy() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_live_pilot_policy()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_live_pilot_policy() TO anon,authenticated;
