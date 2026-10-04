-- Follow-up fixes for Jumia Self Authorization:
-- 1. Allow service-role workers to rotate credentials for active self-authorization integrations.
-- 2. Detect duplicate shop selections by marketplace-qualified identity, not shop_id alone.

CREATE OR REPLACE FUNCTION public.rotate_jumia_authorization_credentials(
  p_authorization_id uuid,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_auth_role text := coalesce(auth.role(), '');
  v_merchant_id uuid;
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
  ELSIF v_user_id IS NULL OR NOT (
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
      'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to rotate Jumia credentials'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
    OR p_token_expires_at <= now()
  THEN
    RAISE EXCEPTION 'Invalid Jumia authorization metadata'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.jumia_authorizations AS jumia_auth_row
  SET
    credential_ciphertext = p_credential_ciphertext,
    token_expires_at = p_token_expires_at,
    rotation_version = jumia_auth_row.rotation_version + 1,
    updated_at = now()
  WHERE jumia_auth_row.id = p_authorization_id
    AND jumia_auth_row.merchant_id = v_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid,
  text,
  timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid,
  text,
  timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.persist_jumia_self_authorization(
  p_merchant_id uuid,
  p_client_key_hash text,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_shop_ids text[],
  p_shop_names text[],
  p_country_codes text[],
  p_marketplace_labels text[]
)
RETURNS TABLE (
  authorization_id uuid,
  integration_id uuid,
  shop_id text,
  inserted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_authorization_id uuid;
  v_index integer;
  v_integration_id uuid;
  v_inserted boolean;
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

  IF p_client_key_hash !~ '^[a-f0-9]{64}$'
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
    OR p_token_expires_at <= now()
  THEN
    RAISE EXCEPTION 'Invalid Jumia authorization metadata'
      USING ERRCODE = '22023';
  END IF;

  IF cardinality(p_shop_ids) < 1
    OR cardinality(p_shop_ids) > 50
    OR cardinality(p_shop_names) <> cardinality(p_shop_ids)
    OR cardinality(p_country_codes) <> cardinality(p_shop_ids)
    OR cardinality(p_marketplace_labels) <> cardinality(p_shop_ids)
  THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids) AS selected_shop(shop_id)
    WHERE btrim(selected_shop.shop_id) = ''
  ) THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids, p_country_codes) AS selected(shop_id, country_code)
    WHERE btrim(selected.shop_id) = '' OR btrim(selected.country_code) = ''
  ) THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids, p_marketplace_labels) AS selected(shop_id, marketplace_key)
    GROUP BY btrim(selected.shop_id), btrim(selected.marketplace_key)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids, p_marketplace_labels) AS selected(shop_id, marketplace_key)
    LEFT JOIN public.marketplace_integrations AS integration
      ON integration.merchant_id = p_merchant_id
      AND integration.platform = 'jumia'
      AND integration.shop_id = btrim(selected.shop_id)
      AND integration.marketplace_key = btrim(selected.marketplace_key)
      AND integration.is_active = true
    WHERE integration.id IS NULL
  ) THEN
    FOR v_index IN 1..cardinality(p_shop_ids) LOOP
      SELECT integration.id
      INTO v_integration_id
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(p_shop_ids[v_index])
        AND integration.marketplace_key = btrim(p_marketplace_labels[v_index])
        AND integration.is_active = true;
      authorization_id := NULL;
      integration_id := v_integration_id;
      shop_id := btrim(p_shop_ids[v_index]);
      inserted := false;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;

  INSERT INTO public.jumia_authorizations AS jumia_auth_row (
    merchant_id,
    client_key_hash,
    credential_ciphertext,
    token_expires_at
  ) VALUES (
    p_merchant_id,
    p_client_key_hash,
    p_credential_ciphertext,
    p_token_expires_at
  )
  ON CONFLICT (merchant_id, client_key_hash) DO UPDATE SET
    credential_ciphertext = EXCLUDED.credential_ciphertext,
    token_expires_at = EXCLUDED.token_expires_at,
    rotation_version = jumia_auth_row.rotation_version + 1,
    updated_at = now()
  RETURNING id INTO v_authorization_id;

  FOR v_index IN 1..cardinality(p_shop_ids) LOOP
    v_inserted := false;

    INSERT INTO public.marketplace_integrations (
      merchant_id,
      platform,
      shop_id,
      marketplace_key,
      shop_name,
      country_code,
      connection_method,
      jumia_authorization_id,
      access_token,
      refresh_token,
      token_expires_at,
      sync_config
    ) VALUES (
      p_merchant_id,
      'jumia',
      btrim(p_shop_ids[v_index]),
      btrim(p_marketplace_labels[v_index]),
      btrim(p_shop_names[v_index]),
      upper(btrim(p_country_codes[v_index])),
      'self_authorization',
      v_authorization_id,
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'stock', true,
        'orders', true,
        'products', true,
        'marketplace', btrim(p_marketplace_labels[v_index])
      )
    )
    ON CONFLICT (merchant_id, platform, shop_id, marketplace_key) DO UPDATE SET
      shop_name = EXCLUDED.shop_name,
      country_code = EXCLUDED.country_code,
      connection_method = EXCLUDED.connection_method,
      jumia_authorization_id = EXCLUDED.jumia_authorization_id,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      sync_config = EXCLUDED.sync_config,
      is_active = true
    WHERE public.marketplace_integrations.is_active = false
    RETURNING id, (xmax = 0) INTO v_integration_id, v_inserted;

    IF v_integration_id IS NOT NULL AND NOT v_inserted THEN
      v_inserted := true;
    END IF;

    IF v_integration_id IS NULL THEN
      SELECT integration.id
      INTO v_integration_id
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(p_shop_ids[v_index]);
    END IF;

    authorization_id := v_authorization_id;
    integration_id := v_integration_id;
    shop_id := btrim(p_shop_ids[v_index]);
    inserted := v_inserted;
    RETURN NEXT;

    v_integration_id := NULL;
    v_inserted := false;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_self_authorization(
  uuid,
  text,
  text,
  timestamptz,
  text[],
  text[],
  text[],
  text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization(
  uuid,
  text,
  text,
  timestamptz,
  text[],
  text[],
  text[],
  text[]
) TO authenticated;
