-- Release a claimed refresh lease when resumed discovery validation fails
-- before the lease-protected rotation RPC can clear it.

CREATE OR REPLACE FUNCTION public.release_jumia_authorization_refresh_lease(
  p_authorization_id uuid,
  p_merchant_id uuid,
  p_refresh_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
  v_rows integer;
BEGIN
  IF p_authorization_id IS NULL
    OR p_merchant_id IS NULL
    OR p_refresh_lease_token IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Jumia authorization refresh lease request'
      USING ERRCODE = '22023';
  END IF;

  IF v_auth_role = 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.jumia_authorization_id = p_authorization_id
        AND integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.connection_method = 'self_authorization'
        AND integration.is_active = true
    ) THEN
      RAISE EXCEPTION 'Not authorized to release Jumia credentials'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id
        AND merchant.user_id = v_user_id
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to release Jumia credentials'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jumia_authorizations AS auth_row
  SET refresh_lease_token = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = now()
  WHERE auth_row.id = p_authorization_id
    AND auth_row.merchant_id = p_merchant_id
    AND auth_row.refresh_lease_token = p_refresh_lease_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.release_jumia_authorization_refresh_lease(
  uuid, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_jumia_authorization_refresh_lease(
  uuid, uuid, uuid
) TO authenticated, service_role;
