-- Keep manage-authorized staff compatible with the shared Jumia grant loader.
-- Credential mutation remains restricted to the manage/trusted worker paths;
-- this function only restores the read permission required by those callers.

CREATE OR REPLACE FUNCTION public.load_jumia_authorization_credentials(
  p_authorization_id uuid, p_merchant_id uuid
)
RETURNS TABLE (
  credential_ciphertext text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  rotation_version bigint,
  client_key_hash text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
BEGIN
  IF p_authorization_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Jumia authorization identifiers are required' USING ERRCODE = '22023';
  END IF;
  IF v_auth_role = 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.marketplace_integrations AS integration
      WHERE integration.jumia_authorization_id = p_authorization_id
        AND integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.connection_method = 'self_authorization'
        AND integration.is_active = true
    ) THEN
      RAISE EXCEPTION 'Not authorized to load Jumia authorization credentials'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'view'
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to load Jumia authorization credentials'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT j.credential_ciphertext, j.token_expires_at,
    j.refresh_token_expires_at, j.rotation_version, j.client_key_hash
  FROM public.jumia_authorizations AS j
  WHERE j.id = p_authorization_id AND j.merchant_id = p_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  TO authenticated, service_role;
