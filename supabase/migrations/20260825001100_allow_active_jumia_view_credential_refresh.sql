-- Allow authenticated integration viewers to rotate credentials only for an active\n-- self-authorization connection. Read-only Jumia routes make provider calls that may\n-- refresh tokens, so their database capability must match that runtime behavior.\n\n
CREATE OR REPLACE FUNCTION public.claim_jumia_authorization_refresh_lease(
  p_authorization_id uuid,
  p_merchant_id uuid,
  p_expected_rotation_version bigint,
  p_lease_seconds integer DEFAULT 45
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
  v_lease_token uuid := gen_random_uuid();
  v_rows integer;
BEGIN
  IF p_authorization_id IS NULL
    OR p_merchant_id IS NULL
    OR p_expected_rotation_version IS NULL
    OR p_expected_rotation_version < 1
    OR p_lease_seconds IS NULL
    OR p_lease_seconds < 5
    OR p_lease_seconds > 120
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
      RAISE EXCEPTION 'Not authorized to refresh Jumia credentials'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_integrations AS integration
    WHERE integration.jumia_authorization_id = p_authorization_id
      AND integration.merchant_id = p_merchant_id
      AND integration.platform = 'jumia'
      AND integration.connection_method = 'self_authorization'
      AND integration.is_active = true
  ) OR v_user_id IS NULL OR NOT (
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
      'view'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to refresh Jumia credentials'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jumia_authorizations AS jumia_auth_row
  SET
    refresh_lease_token = v_lease_token,
    refresh_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE jumia_auth_row.id = p_authorization_id
    AND jumia_auth_row.merchant_id = p_merchant_id
    AND jumia_auth_row.rotation_version = p_expected_rotation_version
    AND (
      jumia_auth_row.refresh_lease_expires_at IS NULL
      OR jumia_auth_row.refresh_lease_expires_at < now()
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 1 THEN
    RETURN v_lease_token;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jumia_authorizations AS jumia_auth_row
    WHERE jumia_auth_row.id = p_authorization_id
      AND jumia_auth_row.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'Jumia authorization not found'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jumia_authorizations AS jumia_auth_row
    WHERE jumia_auth_row.id = p_authorization_id
      AND jumia_auth_row.merchant_id = p_merchant_id
      AND jumia_auth_row.rotation_version = p_expected_rotation_version
  ) THEN
    RAISE EXCEPTION 'Stale Jumia authorization rotation'
      USING ERRCODE = '40001';
  END IF;

  RAISE EXCEPTION 'Jumia authorization refresh already in progress'
    USING ERRCODE = '55P03';
END;
$$;
CREATE OR REPLACE FUNCTION public.rotate_jumia_authorization_credentials(
  p_authorization_id uuid,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_expected_rotation_version bigint,
  p_refresh_lease_token uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
  v_merchant_id uuid;
  v_new_rotation_version bigint;
BEGIN
  SELECT jumia_auth_row.merchant_id
  INTO v_merchant_id
  FROM public.jumia_authorizations AS jumia_auth_row
  WHERE jumia_auth_row.id = p_authorization_id;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Jumia authorization not found'
      USING ERRCODE = '22023';
  END IF;

  IF v_auth_role = 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.jumia_authorization_id = p_authorization_id
        AND integration.merchant_id = v_merchant_id
        AND integration.platform = 'jumia'
        AND integration.connection_method = 'self_authorization'
        AND integration.is_active = true
    ) THEN
      RAISE EXCEPTION 'Not authorized to rotate Jumia credentials'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.marketplace_integrations AS integration
    WHERE integration.jumia_authorization_id = p_authorization_id
      AND integration.merchant_id = v_merchant_id
      AND integration.platform = 'jumia'
      AND integration.connection_method = 'self_authorization'
      AND integration.is_active = true
  ) OR v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = v_merchant_id
        AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id,
      v_merchant_id,
      'integrations',
      'view'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to rotate Jumia credentials'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
    OR p_token_expires_at <= now()
    OR p_expected_rotation_version IS NULL
    OR p_expected_rotation_version < 1
    OR p_refresh_lease_token IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Jumia authorization metadata'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.jumia_authorizations AS jumia_auth_row
  SET
    credential_ciphertext = p_credential_ciphertext,
    token_expires_at = p_token_expires_at,
    rotation_version = jumia_auth_row.rotation_version + 1,
    refresh_lease_token = NULL,
    refresh_lease_expires_at = NULL,
    updated_at = now()
  WHERE jumia_auth_row.id = p_authorization_id
    AND jumia_auth_row.merchant_id = v_merchant_id
    AND jumia_auth_row.rotation_version = p_expected_rotation_version
    AND jumia_auth_row.refresh_lease_token = p_refresh_lease_token
    AND jumia_auth_row.refresh_lease_expires_at > now()
  RETURNING jumia_auth_row.rotation_version INTO v_new_rotation_version;

  IF v_new_rotation_version IS NULL THEN
    RAISE EXCEPTION 'Stale Jumia authorization rotation'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_new_rotation_version;
END;
$$;
