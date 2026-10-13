-- Persist the provider business-client code as marketplace_key while retaining
-- the provider's display label in sync_config. Distinct active business clients
-- may share a provider shop, but OAuth overlap and duplicate selections fail.

CREATE OR REPLACE FUNCTION public.persist_jumia_self_authorization(
  p_merchant_id uuid,
  p_client_key_hash text,
  p_credential_ciphertext text,
  p_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_shop_ids text[],
  p_shop_names text[],
  p_country_codes text[],
  p_marketplace_labels text[],
  p_business_client_codes text[]
)
RETURNS TABLE (authorization_id uuid, integration_id uuid, shop_id text, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    ) OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  IF p_client_key_hash !~ '^[a-f0-9]{64}$'
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
    OR p_token_expires_at <= now()
    OR p_refresh_token_expires_at IS NULL
    OR p_refresh_token_expires_at <= now()
    OR p_shop_ids IS NULL
    OR p_shop_names IS NULL
    OR p_country_codes IS NULL
    OR p_marketplace_labels IS NULL
    OR p_business_client_codes IS NULL
    OR cardinality(p_shop_ids) < 1
    OR cardinality(p_shop_ids) > 50
    OR cardinality(p_shop_names) <> cardinality(p_shop_ids)
    OR cardinality(p_country_codes) <> cardinality(p_shop_ids)
    OR cardinality(p_marketplace_labels) <> cardinality(p_shop_ids)
    OR cardinality(p_business_client_codes) <> cardinality(p_shop_ids)
  THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids, p_business_client_codes)
      AS selected(shop_id, business_client_code)
    GROUP BY btrim(selected.shop_id), btrim(selected.business_client_code)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Jumia shop selection'
      USING ERRCODE = '22023';
  END IF;

  FOR v_index IN 1..cardinality(p_shop_ids) LOOP
    IF p_shop_ids[v_index] IS NULL
      OR p_shop_names[v_index] IS NULL
      OR p_country_codes[v_index] IS NULL
      OR p_marketplace_labels[v_index] IS NULL
      OR p_business_client_codes[v_index] IS NULL
      OR btrim(p_shop_ids[v_index]) = ''
      OR btrim(p_shop_names[v_index]) = ''
      OR btrim(p_country_codes[v_index]) = ''
      OR btrim(p_marketplace_labels[v_index]) = ''
      OR btrim(p_business_client_codes[v_index]) = ''
    THEN
      RAISE EXCEPTION 'Invalid Jumia shop selection'
        USING ERRCODE = '22023';
    END IF;

    -- Serialize self-authorization writes for the same provider shop. This
    -- closes the no-row race before checking OAuth and self-auth conflicts.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_merchant_id::text || ':' || btrim(p_shop_ids[v_index]), 0
    ));

    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(p_shop_ids[v_index])
        AND integration.connection_method = 'oauth'
        AND integration.is_active = true
    ) THEN
      RAISE EXCEPTION 'Jumia shop is already connected through OAuth'
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(p_shop_ids[v_index])
        AND integration.marketplace_key = btrim(p_business_client_codes[v_index])
        AND integration.connection_method = 'self_authorization'
        AND integration.is_active = true
    ) THEN
      RAISE EXCEPTION 'Jumia marketplace is already connected'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  INSERT INTO public.jumia_authorizations AS jumia_auth_row (
    merchant_id,
    client_key_hash,
    credential_ciphertext,
    token_expires_at,
    refresh_token_expires_at
  ) VALUES (
    p_merchant_id,
    p_client_key_hash,
    p_credential_ciphertext,
    p_token_expires_at,
    p_refresh_token_expires_at
  )
  ON CONFLICT (merchant_id, client_key_hash) DO UPDATE SET
    credential_ciphertext = EXCLUDED.credential_ciphertext,
    token_expires_at = EXCLUDED.token_expires_at,
    refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
    rotation_version = jumia_auth_row.rotation_version + 1,
    updated_at = now()
  RETURNING id INTO v_authorization_id;

  FOR v_index IN 1..cardinality(p_shop_ids) LOOP
    v_integration_id := NULL;
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
      btrim(p_business_client_codes[v_index]),
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
        'marketplace', btrim(p_marketplace_labels[v_index]),
        'businessClientCode', btrim(p_business_client_codes[v_index])
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

    IF v_integration_id IS NULL THEN
      SELECT integration.id
      INTO v_integration_id
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(p_shop_ids[v_index])
        AND integration.marketplace_key = btrim(p_business_client_codes[v_index]);
      v_inserted := false;
    END IF;

    authorization_id := v_authorization_id;
    integration_id := v_integration_id;
    shop_id := btrim(p_shop_ids[v_index]);
    inserted := coalesce(v_inserted, false);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, timestamptz, text[], text[], text[], text[], text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, timestamptz, text[], text[], text[], text[], text[]
) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_jumia_active_shop_connection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.platform <> 'jumia'
    OR NEW.is_active IS NOT TRUE
    OR NEW.shop_id IS NULL
    OR btrim(NEW.shop_id) = ''
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.merchant_id::text || ':' || btrim(NEW.shop_id), 0
  ));

  IF NEW.connection_method = 'oauth'
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.id IS DISTINCT FROM NEW.id
        AND integration.merchant_id = NEW.merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(NEW.shop_id)
        AND integration.is_active = true
    )
  THEN
    RAISE EXCEPTION 'Jumia shop is already connected'
      USING ERRCODE = '23505';
  END IF;

  IF NEW.connection_method = 'self_authorization'
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.id IS DISTINCT FROM NEW.id
        AND integration.merchant_id = NEW.merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(NEW.shop_id)
        AND integration.connection_method = 'oauth'
        AND integration.is_active = true
    )
  THEN
    RAISE EXCEPTION 'Jumia shop is already connected through OAuth'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_jumia_active_shop_connection_trigger
  ON public.marketplace_integrations;
CREATE TRIGGER enforce_jumia_active_shop_connection_trigger
BEFORE INSERT OR UPDATE OF shop_id, marketplace_key, connection_method, is_active
ON public.marketplace_integrations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_jumia_active_shop_connection();
