-- Keep provider-shop advisory locks and the OAuth integration upsert in one
-- transaction so concurrent OAuth and self-authorization writes cannot deadlock.
CREATE OR REPLACE FUNCTION public.persist_jumia_oauth_integrations_atomically(
  p_merchant_id uuid,
  p_integrations jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_shop_id text;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_integrations) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_integrations) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'Invalid Jumia OAuth integrations'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_integrations) AS integration(
      merchant_id text,
      platform text,
      shop_id text,
      marketplace_key text,
      connection_method text,
      shop_name text,
      country_code text,
      access_token text,
      refresh_token text,
      token_expires_at timestamptz,
      is_active boolean,
      jumia_authorization_id uuid,
      sync_config jsonb
    )
    WHERE integration.merchant_id IS DISTINCT FROM p_merchant_id::text
      OR integration.platform IS DISTINCT FROM 'jumia'
      OR integration.connection_method IS DISTINCT FROM 'oauth'
      OR integration.shop_id IS NULL OR btrim(integration.shop_id) = ''
      OR integration.marketplace_key IS NULL
      OR btrim(integration.marketplace_key) = ''
      OR integration.shop_name IS NULL OR btrim(integration.shop_name) = ''
      OR integration.country_code IS NULL
      OR btrim(integration.country_code) = ''
      OR integration.access_token IS NULL OR integration.access_token = ''
      OR integration.token_expires_at IS NULL
      OR integration.token_expires_at <= now()
      OR integration.is_active IS NULL
      OR integration.jumia_authorization_id IS NOT NULL
      OR jsonb_typeof(integration.sync_config) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'Invalid Jumia OAuth integration row'
      USING ERRCODE = '22023';
  END IF;

  FOR v_shop_id IN
    SELECT DISTINCT btrim(integration.shop_id)
    FROM jsonb_to_recordset(p_integrations) AS integration(shop_id text)
    ORDER BY btrim(integration.shop_id)
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_merchant_id::text || ':' || v_shop_id, 0
    ));
  END LOOP;

  INSERT INTO public.marketplace_integrations AS existing (
    merchant_id,
    platform,
    shop_id,
    marketplace_key,
    shop_name,
    country_code,
    access_token,
    refresh_token,
    token_expires_at,
    connection_method,
    jumia_authorization_id,
    is_active,
    sync_config
  )
  SELECT
    p_merchant_id,
    'jumia',
    btrim(integration.shop_id),
    btrim(integration.marketplace_key),
    integration.shop_name,
    integration.country_code,
    integration.access_token,
    integration.refresh_token,
    integration.token_expires_at,
    'oauth',
    NULL,
    integration.is_active,
    integration.sync_config
  FROM jsonb_to_recordset(p_integrations) AS integration(
    shop_id text,
    marketplace_key text,
    shop_name text,
    country_code text,
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    is_active boolean,
    sync_config jsonb
  )
  ON CONFLICT (merchant_id, platform, shop_id, marketplace_key)
  DO UPDATE SET
    shop_name = EXCLUDED.shop_name,
    country_code = EXCLUDED.country_code,
    access_token = EXCLUDED.access_token,
    refresh_token = EXCLUDED.refresh_token,
    token_expires_at = EXCLUDED.token_expires_at,
    connection_method = 'oauth',
    jumia_authorization_id = NULL,
    is_active = EXCLUDED.is_active,
    sync_config = EXCLUDED.sync_config,
    updated_at = now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_oauth_integrations_atomically(
  uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_oauth_integrations_atomically(
  uuid, jsonb
) TO authenticated;
