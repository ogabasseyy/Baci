-- Validate caller authority and the complete selection before taking any locks.
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

-- OAuth uses the same deterministic provider-shop lock order before batch upserts.
CREATE OR REPLACE FUNCTION public.lock_jumia_oauth_shops(
  p_merchant_id uuid,
  p_shop_ids text[]
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
  IF p_shop_ids IS NULL OR cardinality(p_shop_ids) NOT BETWEEN 1 AND 50
    OR EXISTS (
      SELECT 1 FROM unnest(p_shop_ids) AS item(shop_id)
      WHERE item.shop_id IS NULL OR btrim(item.shop_id) = ''
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
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_jumia_oauth_shops(uuid, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_jumia_oauth_shops(uuid, text[])
  TO authenticated;

-- An active sibling marketplace only protects the authorization it references.
CREATE OR REPLACE FUNCTION public.purge_orphaned_jumia_authorizations()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_candidate record;
BEGIN
  FOR v_candidate IN
    SELECT DISTINCT integration.merchant_id, integration.shop_id,
                    integration.jumia_authorization_id
    FROM public.marketplace_integrations AS integration
    WHERE integration.platform = 'jumia'
      AND integration.is_active = false
      AND integration.jumia_authorization_id IS NOT NULL
    ORDER BY integration.merchant_id, integration.shop_id,
             integration.jumia_authorization_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_candidate.merchant_id::text || ':' || btrim(v_candidate.shop_id), 0
    ));

    UPDATE public.marketplace_integrations
    SET jumia_authorization_id = NULL
    WHERE merchant_id = v_candidate.merchant_id
      AND platform = 'jumia'
      AND shop_id = btrim(v_candidate.shop_id)
      AND jumia_authorization_id = v_candidate.jumia_authorization_id
      AND is_active = false;

    IF EXISTS (
      SELECT 1 FROM public.marketplace_integrations
      WHERE jumia_authorization_id = v_candidate.jumia_authorization_id
        AND platform = 'jumia'
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.jumia_authorizations
    SET credential_ciphertext = repeat('0', 32), updated_at = now()
    WHERE id = v_candidate.jumia_authorization_id;
    DELETE FROM public.jumia_authorizations
    WHERE id = v_candidate.jumia_authorization_id;
    v_deleted := v_deleted + 1;
  END LOOP;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_orphaned_jumia_authorizations() FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_orphaned_jumia_authorizations() TO service_role;
