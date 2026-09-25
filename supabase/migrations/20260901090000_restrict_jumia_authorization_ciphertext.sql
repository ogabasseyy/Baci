-- Keep encrypted Jumia credentials and their lookup hash out of direct
-- PostgREST reads. Server-side RPCs remain the only credential boundary.

REVOKE SELECT ON TABLE public.jumia_authorizations FROM authenticated;
GRANT SELECT (
  id,
  merchant_id,
  token_expires_at,
  refresh_token_expires_at,
  rotation_version,
  created_at,
  updated_at
)
ON TABLE public.jumia_authorizations TO authenticated;

CREATE OR REPLACE FUNCTION public.find_jumia_authorization_metadata(
  p_merchant_id uuid,
  p_client_key_hash text
)
RETURNS TABLE (
  id uuid,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  rotation_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
BEGIN
  IF p_merchant_id IS NULL
    OR p_client_key_hash IS NULL
    OR p_client_key_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Invalid Jumia authorization metadata'
      USING ERRCODE = '22023';
  END IF;

  IF v_auth_role <> 'service_role'
    AND (
      v_user_id IS NULL
      OR NOT (
        EXISTS (
          SELECT 1
          FROM public.merchants AS merchant
          WHERE merchant.id = p_merchant_id
            AND merchant.user_id = v_user_id
        )
        OR public.check_staff_permission(
          v_user_id,
          p_merchant_id,
          'integrations',
          'manage'
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Not authorized to load Jumia authorization metadata'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    auth_row.id,
    auth_row.token_expires_at,
    auth_row.refresh_token_expires_at,
    auth_row.rotation_version
  FROM public.jumia_authorizations AS auth_row
  WHERE auth_row.merchant_id = p_merchant_id
    AND auth_row.client_key_hash = p_client_key_hash
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.connection_method = 'self_authorization'
        AND integration.jumia_authorization_id = auth_row.id
        AND integration.is_active = true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.find_jumia_authorization_metadata(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_jumia_authorization_metadata(uuid, text)
  TO authenticated, service_role;
