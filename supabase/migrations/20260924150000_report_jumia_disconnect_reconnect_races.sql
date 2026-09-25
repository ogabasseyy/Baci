-- Report disconnect-vs-reconnect races instead of a false success.
-- The route deactivates the integration before this cleanup RPC acquires
-- its shop advisory lock. A reconnect that discovers the shop in between
-- takes the lock first and reactivates the row; the previous void RPC then
-- filtered for is_active = false, returned without detaching the grant,
-- and the route reported a successful disconnect while the integration
-- stayed active. The RPC now re-reads the row under the shop lock and
-- reports 'reactivated' when a concurrent reconnect won, so the route
-- answers 409 instead of a success toast. Return type changes require
-- DROP + CREATE; grants are re-issued unchanged.

DROP FUNCTION IF EXISTS public.purge_orphaned_jumia_authorization(uuid, uuid);

CREATE FUNCTION public.purge_orphaned_jumia_authorization(
  p_merchant_id uuid,
  p_integration_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_authorization_id uuid;
  v_shop_id text;
  v_is_active boolean;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  -- No active filter: the caller deactivated first, so an active row here
  -- means a concurrent reconnect already won the race.
  SELECT integration.shop_id, integration.jumia_authorization_id,
    integration.is_active
  INTO v_shop_id, v_authorization_id, v_is_active
  FROM public.marketplace_integrations AS integration
  WHERE integration.id = p_integration_id
    AND integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia';

  IF v_shop_id IS NULL THEN RETURN 'not_found'; END IF;
  -- Already detached (concurrent disconnect): idempotent success.
  IF v_authorization_id IS NULL THEN RETURN 'purged'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_merchant_id::text || ':' || btrim(v_shop_id), 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_merchant_id::text || ':authorization:' || v_authorization_id::text, 0
  ));

  -- Authoritative re-read under the shop lock: reconnect persistence takes
  -- the same lock before reactivating, so this ordering is total.
  SELECT integration.shop_id, integration.jumia_authorization_id,
    integration.is_active
  INTO v_shop_id, v_authorization_id, v_is_active
  FROM public.marketplace_integrations AS integration
  WHERE integration.id = p_integration_id
    AND integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia'
  FOR UPDATE;

  IF v_shop_id IS NULL THEN RETURN 'not_found'; END IF;
  IF v_authorization_id IS NULL THEN RETURN 'purged'; END IF;
  -- A live connection won the race; never silently kill a fresh reconnect.
  IF v_is_active THEN RETURN 'reactivated'; END IF;

  UPDATE public.marketplace_integrations AS integration
  SET jumia_authorization_id = NULL
  WHERE integration.id = p_integration_id
    AND integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia'
    AND integration.is_active = false
    AND integration.jumia_authorization_id = v_authorization_id;

  IF EXISTS (
    SELECT 1 FROM public.marketplace_integrations AS integration
    WHERE integration.jumia_authorization_id = v_authorization_id
      AND integration.merchant_id = p_merchant_id
      AND integration.platform = 'jumia'
  ) THEN
    RETURN 'purged';
  END IF;

  UPDATE public.jumia_authorizations AS jumia_auth_row
  SET credential_ciphertext = repeat('0', 32), updated_at = now()
  WHERE jumia_auth_row.id = v_authorization_id
    AND jumia_auth_row.merchant_id = p_merchant_id;

  DELETE FROM public.jumia_authorizations AS jumia_auth_row
  WHERE jumia_auth_row.id = v_authorization_id
    AND jumia_auth_row.merchant_id = p_merchant_id;

  RETURN 'purged';
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorization(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorization(uuid, uuid)
  TO authenticated;
