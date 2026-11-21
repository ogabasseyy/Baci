-- Public metadata only: ordinary authenticated customer access, no worker login.
CREATE OR REPLACE FUNCTION public.oxygen_mobile_staging_readiness(p_merchant_slug text)
RETURNS TABLE(merchant_id uuid, merchant_slug text, environment text, binding_ready boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
 END IF;
 IF p_merchant_slug IS NULL OR length(p_merchant_slug)>100
  OR p_merchant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
  RAISE EXCEPTION 'Invalid storefront' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT m.id,m.slug,b.environment,coalesce(b.enabled,false)
 FROM public.merchants m
 LEFT JOIN oxygen_private.runtime_bindings b ON b.merchant_id=m.id
 WHERE m.slug=p_merchant_slug AND EXISTS (
  SELECT 1 FROM public.customers c
  WHERE c.merchant_id=m.id AND c.user_id=auth.uid()
 );
END;
$$;
REVOKE ALL ON FUNCTION public.oxygen_mobile_staging_readiness(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_mobile_staging_readiness(text) TO authenticated;
COMMENT ON FUNCTION public.oxygen_mobile_staging_readiness(text) IS
 'Read-only owned merchant binding metadata; no provider identity, activation policy, or new-initiation authorization.';
NOTIFY pgrst,'reload schema';
