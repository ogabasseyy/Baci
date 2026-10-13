-- Require and retain the refresh-token expiry returned by Jumia for rotating
-- self-authorization credentials. Web OAuth integrations keep optional fields.

ALTER TABLE public.jumia_authorizations
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.persist_jumia_self_authorization(
  p_merchant_id uuid,
  p_client_key_hash text,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_shop_ids text[],
  p_shop_names text[],
  p_country_codes text[],
  p_marketplace_labels text[]
)
RETURNS TABLE (authorization_id uuid, integration_id uuid, shop_id text, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row record;
BEGIN
  IF p_refresh_token_expires_at IS NULL OR p_refresh_token_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid Jumia refresh-token expiry' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN
    SELECT * FROM public.persist_jumia_self_authorization(
      p_merchant_id, p_client_key_hash, p_credential_ciphertext,
      p_token_expires_at, p_shop_ids, p_shop_names, p_country_codes,
      p_marketplace_labels
    )
  LOOP
    IF v_row.authorization_id IS NOT NULL THEN
      UPDATE public.jumia_authorizations
      SET refresh_token_expires_at = p_refresh_token_expires_at, updated_at = now()
      WHERE id = v_row.authorization_id AND merchant_id = p_merchant_id;
    END IF;
    authorization_id := v_row.authorization_id;
    integration_id := v_row.integration_id;
    shop_id := v_row.shop_id;
    inserted := v_row.inserted;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, timestamptz, text[], text[], text[], text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, timestamptz, text[], text[], text[], text[]
) TO authenticated;

CREATE OR REPLACE FUNCTION public.rotate_jumia_authorization_credentials(
  p_authorization_id uuid,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_expected_rotation_version bigint,
  p_refresh_lease_token uuid
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_rotation_version bigint;
BEGIN
  IF p_refresh_token_expires_at IS NULL OR p_refresh_token_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid Jumia refresh-token expiry' USING ERRCODE = '22023';
  END IF;
  v_rotation_version := public.rotate_jumia_authorization_credentials(
    p_authorization_id, p_credential_ciphertext, p_token_expires_at,
    p_expected_rotation_version, p_refresh_lease_token
  );
  UPDATE public.jumia_authorizations
  SET refresh_token_expires_at = p_refresh_token_expires_at, updated_at = now()
  WHERE id = p_authorization_id;
  RETURN v_rotation_version;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid, text, timestamptz, timestamptz, bigint, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid, text, timestamptz, timestamptz, bigint, uuid
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.load_jumia_authorization_credentials(uuid, uuid);

CREATE FUNCTION public.load_jumia_authorization_credentials(
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
