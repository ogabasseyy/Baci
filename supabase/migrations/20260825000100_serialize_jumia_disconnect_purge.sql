-- Serialize the authenticated disconnect cleanup with self-authorization
-- reconnects for the same provider shop.

CREATE OR REPLACE FUNCTION public.purge_orphaned_jumia_authorization(
  p_merchant_id uuid,
  p_integration_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_authorization_id uuid;
  v_shop_id text;
BEGIN
  IF v_user_id IS NULL OR NOT (
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
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  SELECT integration.shop_id
  INTO v_shop_id
  FROM public.marketplace_integrations AS integration
  WHERE integration.id = p_integration_id
    AND integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia'
    AND integration.is_active = false;

  IF v_shop_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_merchant_id::text || ':' || btrim(v_shop_id), 0
  ));

  SELECT integration.jumia_authorization_id
  INTO v_authorization_id
  FROM public.marketplace_integrations AS integration
  WHERE integration.id = p_integration_id
    AND integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia'
    AND integration.is_active = false
  FOR UPDATE;

  IF v_authorization_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.marketplace_integrations AS integration
    WHERE integration.jumia_authorization_id = v_authorization_id
      AND integration.merchant_id = p_merchant_id
      AND integration.platform = 'jumia'
      AND integration.is_active = true
  ) THEN
    RETURN;
  END IF;

  UPDATE public.marketplace_integrations AS integration
  SET jumia_authorization_id = NULL
  WHERE integration.jumia_authorization_id = v_authorization_id
    AND integration.merchant_id = p_merchant_id
    AND integration.is_active = false;

  UPDATE public.jumia_authorizations AS jumia_auth_row
  SET
    credential_ciphertext = repeat('0', 32),
    updated_at = now()
  WHERE jumia_auth_row.id = v_authorization_id
    AND jumia_auth_row.merchant_id = p_merchant_id;

  DELETE FROM public.jumia_authorizations AS jumia_auth_row
  WHERE jumia_auth_row.id = v_authorization_id
    AND jumia_auth_row.merchant_id = p_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorization(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorization(uuid, uuid)
  TO authenticated;
