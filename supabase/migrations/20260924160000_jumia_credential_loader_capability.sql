-- Load Jumia credential grants through a merchant-bound capability role.
-- Browser-reachable execution was revoked from authenticated, but user-facing
-- server routes must not elevate to service_role either. This introduces the
-- jumia_credential_loader boundary (mirroring repair_pickup_receiver): the
-- server mints a short-lived JWT binding user, merchant, and context after
-- its own owner/manage check, and the RPC re-verifies those claims plus the
-- owner/manage rule in the database, so the database remains authoritative.
-- The pre-existing service_role worker path is unchanged.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'jumia_credential_loader'
  ) THEN
    CREATE ROLE jumia_credential_loader NOLOGIN;
  END IF;
END;
$migration$;

GRANT jumia_credential_loader TO authenticator;
GRANT USAGE ON SCHEMA public TO jumia_credential_loader;

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
  v_auth_role text := coalesce(auth.role(), '');
  v_capability_user_id uuid;
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
  ELSIF v_auth_role = 'jumia_credential_loader' THEN
    IF COALESCE(auth.jwt() ->> 'jumia_credential_context', '')
        IS DISTINCT FROM 'server-grant-load'
      OR COALESCE(auth.jwt() ->> 'jumia_credential_merchant_id', '')
        IS DISTINCT FROM p_merchant_id::text
      OR COALESCE(auth.jwt() ->> 'jumia_credential_user_id', '')
        !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN
      RAISE EXCEPTION 'Not authorized to load Jumia authorization credentials'
        USING ERRCODE = '42501';
    END IF;
    v_capability_user_id :=
      (auth.jwt() ->> 'jumia_credential_user_id')::uuid;
    IF NOT (
      EXISTS (
        SELECT 1 FROM public.merchants AS merchant
        WHERE merchant.id = p_merchant_id
          AND merchant.user_id = v_capability_user_id
      ) OR public.check_staff_permission(
        v_capability_user_id, p_merchant_id, 'integrations', 'manage'
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to load Jumia authorization credentials'
        USING ERRCODE = '42501';
    END IF;
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
  ELSE
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

COMMENT ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid) IS
  'Server-capability-only Jumia grant loading; ordinary authenticated JWTs receive no credential ciphertext.';

REVOKE ALL ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_jumia_authorization_credentials(uuid, uuid)
  TO service_role, jumia_credential_loader;

NOTIFY pgrst, 'reload schema';
