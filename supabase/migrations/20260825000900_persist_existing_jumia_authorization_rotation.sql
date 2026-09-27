-- When reconnect validation rotates a Self Authorization token, persist that
-- rotation even if every selected marketplace is already active. The ordered
-- wrapper owns this special case so the base connect function can continue to
-- reject active-row takeovers.
CREATE OR REPLACE FUNCTION public.persist_jumia_self_authorization_ordered(
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
  v_shop_id text;
  v_authorization_id uuid;
  v_matching_count integer;
  v_authorization_count integer;
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
    OR p_shop_ids IS NULL OR p_shop_names IS NULL
    OR p_country_codes IS NULL OR p_marketplace_labels IS NULL
    OR p_business_client_codes IS NULL
    OR cardinality(p_shop_ids) NOT BETWEEN 1 AND 50
    OR cardinality(p_shop_names) <> cardinality(p_shop_ids)
    OR cardinality(p_country_codes) <> cardinality(p_shop_ids)
    OR cardinality(p_marketplace_labels) <> cardinality(p_shop_ids)
    OR cardinality(p_business_client_codes) <> cardinality(p_shop_ids)
    OR EXISTS (
      SELECT 1
      FROM unnest(p_shop_ids, p_business_client_codes)
        AS selected(shop_id, business_client_code)
      GROUP BY btrim(selected.shop_id), btrim(selected.business_client_code)
      HAVING count(*) > 1
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(p_shop_ids, p_shop_names, p_country_codes,
                  p_marketplace_labels, p_business_client_codes)
        AS item(shop_id, shop_name, country_code, marketplace_label, business_client_code)
      WHERE item.shop_id IS NULL OR btrim(item.shop_id) = ''
        OR item.shop_name IS NULL OR btrim(item.shop_name) = ''
        OR item.country_code IS NULL OR btrim(item.country_code) = ''
        OR item.marketplace_label IS NULL OR btrim(item.marketplace_label) = ''
        OR item.business_client_code IS NULL OR btrim(item.business_client_code) = ''
    )
  THEN
    RAISE EXCEPTION 'Invalid Jumia shop selection' USING ERRCODE = '22023';
  END IF;

  FOR v_shop_id IN
    SELECT DISTINCT btrim(item.shop_id)
    FROM unnest(p_shop_ids) AS item(shop_id)
    ORDER BY btrim(item.shop_id)
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_merchant_id::text || ':' || v_shop_id, 0
    ));
  END LOOP;

  SELECT
    (array_agg(jumia_auth.id))[1],
    count(*)::integer,
    count(DISTINCT jumia_auth.id)::integer
  INTO v_authorization_id, v_matching_count, v_authorization_count
  FROM unnest(p_shop_ids, p_business_client_codes)
    AS selected(shop_id, business_client_code)
  JOIN public.marketplace_integrations AS integration
    ON integration.merchant_id = p_merchant_id
    AND integration.platform = 'jumia'
    AND integration.shop_id = btrim(selected.shop_id)
    AND integration.marketplace_key = btrim(selected.business_client_code)
    AND integration.connection_method = 'self_authorization'
    AND integration.is_active = true
  JOIN public.jumia_authorizations AS jumia_auth
    ON jumia_auth.id = integration.jumia_authorization_id
    AND jumia_auth.merchant_id = p_merchant_id
    AND jumia_auth.client_key_hash = p_client_key_hash;

  IF v_matching_count = cardinality(p_shop_ids)
    AND v_authorization_count = 1
  THEN
    UPDATE public.jumia_authorizations AS jumia_auth
    SET
      credential_ciphertext = p_credential_ciphertext,
      token_expires_at = p_token_expires_at,
      refresh_token_expires_at = p_refresh_token_expires_at,
      rotation_version = jumia_auth.rotation_version + 1,
      updated_at = now()
    WHERE id = v_authorization_id
      AND merchant_id = p_merchant_id
      AND client_key_hash = p_client_key_hash;

    RETURN QUERY
    SELECT
      v_authorization_id,
      integration.id,
      btrim(selected.shop_id),
      false
    FROM unnest(p_shop_ids, p_business_client_codes) WITH ORDINALITY
      AS selected(shop_id, business_client_code, position)
    JOIN public.marketplace_integrations AS integration
      ON integration.merchant_id = p_merchant_id
      AND integration.platform = 'jumia'
      AND integration.shop_id = btrim(selected.shop_id)
      AND integration.marketplace_key = btrim(selected.business_client_code)
      AND integration.jumia_authorization_id = v_authorization_id
      AND integration.connection_method = 'self_authorization'
      AND integration.is_active = true
    ORDER BY selected.position;
    RETURN;
  END IF;

  -- Existing OAuth ownership remains untouched and is reported as a skipped
  -- connection, matching the connect handler's preflight classification.
  IF NOT EXISTS (
    SELECT 1
    FROM unnest(p_shop_ids) AS selected(shop_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(selected.shop_id)
        AND integration.connection_method = 'oauth'
        AND integration.is_active = true
    )
  ) THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      existing.id,
      btrim(selected.shop_id),
      false
    FROM unnest(p_shop_ids) WITH ORDINALITY
      AS selected(shop_id, position)
    CROSS JOIN LATERAL (
      SELECT integration.id
      FROM public.marketplace_integrations AS integration
      WHERE integration.merchant_id = p_merchant_id
        AND integration.platform = 'jumia'
        AND integration.shop_id = btrim(selected.shop_id)
        AND integration.connection_method = 'oauth'
        AND integration.is_active = true
      ORDER BY integration.id
      LIMIT 1
    ) AS existing
    ORDER BY selected.position;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.persist_jumia_self_authorization(
    p_merchant_id, p_client_key_hash, p_credential_ciphertext,
    p_token_expires_at, p_refresh_token_expires_at, p_shop_ids, p_shop_names,
    p_country_codes, p_marketplace_labels, p_business_client_codes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_jumia_self_authorization_ordered(
  uuid, text, text, timestamptz, timestamptz,
  text[], text[], text[], text[], text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization_ordered(
  uuid, text, text, timestamptz, timestamptz,
  text[], text[], text[], text[], text[]
) TO authenticated;
