-- Publish preflight must independently recheck the live connection's publish grant.
-- Normal authenticated RPC only; no service-role client or hosted activation.
CREATE FUNCTION public.experience_authorize_publish(
  p_merchant uuid, p_connection uuid DEFAULT NULL, p_version bigint DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.experience_authorize_read(p_merchant, p_connection, p_version);
  IF p_connection IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM builder_authorization.connections c
    WHERE c.id = p_connection AND c.grant_version = p_version
      AND 'storefront.publish' = ANY(c.scopes)
  ) THEN
    RAISE EXCEPTION 'INSUFFICIENT_SCOPE' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.experience_authorize_publish(uuid,uuid,bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.experience_authorize_publish(uuid,uuid,bigint) TO authenticated;
