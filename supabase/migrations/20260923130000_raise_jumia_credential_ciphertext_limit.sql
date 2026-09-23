-- Raise Jumia encrypted-credential storage limits from 16k to 32k.
--
-- The API accepts refresh tokens up to 8,192 chars and provider token
-- responses have no length ceiling. The nested base64 envelope expands
-- credential JSON ~1.8x, so a near-max refresh token plus a moderately
-- sized access token exceeds the 16,384-char table CHECK after the
-- provider exchange has already succeeded. Raise the table CHECKs and
-- the matching RPC guards together so either layer accepts the same
-- ciphertexts.

-- Discoveries handoff (named constraint).
ALTER TABLE public.jumia_self_authorization_discoveries
  DROP CONSTRAINT IF EXISTS jumia_self_authorization_discoveries_credential_ciphertext_check;
ALTER TABLE public.jumia_self_authorization_discoveries
  ADD CONSTRAINT jumia_self_authorization_discoveries_credential_ciphertext_check
  CHECK (char_length(credential_ciphertext) BETWEEN 32 AND 32768);

-- Shared grants (the original CHECK is unnamed, so drop by definition).
DO $$
DECLARE
  v_conname text;
BEGIN
  -- pg_get_constraintdef renders BETWEEN as >= AND <=, so match the
  -- column and the old ceiling rather than the source text.
  SELECT con.conname INTO v_conname
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = 'public.jumia_authorizations'::pg_catalog.regclass
    AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%credential_ciphertext%16384%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jumia_authorizations DROP CONSTRAINT %I', v_conname);
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS existing
    WHERE existing.conrelid = 'public.jumia_authorizations'::pg_catalog.regclass
      AND existing.conname = 'jumia_authorizations_credential_ciphertext_check'
  ) THEN
    RAISE EXCEPTION 'expected 16k credential check on jumia_authorizations not found'
      USING ERRCODE = '22023';
  END IF;
END
$$;
ALTER TABLE public.jumia_authorizations
  DROP CONSTRAINT IF EXISTS jumia_authorizations_credential_ciphertext_check;
ALTER TABLE public.jumia_authorizations
  ADD CONSTRAINT jumia_authorizations_credential_ciphertext_check
  CHECK (char_length(credential_ciphertext) BETWEEN 32 AND 32768);

-- RPC guards (bodies copied verbatim from the latest definitions).
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
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 32768
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
    RETURNING id,
      -- Fresh inserts and inactive-row reactivations both succeed for connect UX.
      true INTO v_integration_id, v_inserted;

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
  p_business_client_codes text[],
  p_expected_rotation_version bigint DEFAULT NULL
)
RETURNS TABLE (authorization_id uuid, integration_id uuid, shop_id text, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_shop_id text;
  v_existing_authorization_id uuid;
  v_authorization_id uuid;
  v_matching_count integer;
  v_authorization_count integer;
  v_current_credential_ciphertext text;
  v_current_token_expires_at timestamptz;
  v_current_refresh_token_expires_at timestamptz;
  v_current_rotation_version bigint;
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
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 32768
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

  -- Lock the shared grant before comparing its version. This prevents a
  -- worker rotation from interleaving between the comparison and persistence.
  SELECT
    auth_row.id,
    auth_row.credential_ciphertext,
    auth_row.token_expires_at,
    auth_row.refresh_token_expires_at,
    auth_row.rotation_version
  INTO
    v_existing_authorization_id,
    v_current_credential_ciphertext,
    v_current_token_expires_at,
    v_current_refresh_token_expires_at,
    v_current_rotation_version
  FROM public.jumia_authorizations AS auth_row
  WHERE auth_row.merchant_id = p_merchant_id
    AND auth_row.client_key_hash = p_client_key_hash
  FOR UPDATE;

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
    -- A stale request must never replace the winner. If the version still
    -- matches, the request owns the compare-and-swap; otherwise leave the
    -- current grant untouched and report the existing integrations.
    IF p_expected_rotation_version IS NULL
      OR v_current_rotation_version = p_expected_rotation_version
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
        AND client_key_hash = p_client_key_hash
        AND (
          p_expected_rotation_version IS NULL
          OR rotation_version = p_expected_rotation_version
        );
    END IF;

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

  -- When another actor won the rotation, pass the current grant metadata to
  -- the legacy integration writer while the row lock is still held. The
  -- winning ciphertext is preserved and the selected shops can still attach
  -- to that grant in this transaction.
  IF p_expected_rotation_version IS NOT NULL
    AND v_existing_authorization_id IS NOT NULL
    AND v_current_rotation_version IS DISTINCT FROM p_expected_rotation_version
  THEN
    RETURN QUERY SELECT * FROM public.persist_jumia_self_authorization(
      p_merchant_id, p_client_key_hash, v_current_credential_ciphertext,
      v_current_token_expires_at, v_current_refresh_token_expires_at,
      p_shop_ids, p_shop_names, p_country_codes, p_marketplace_labels,
      p_business_client_codes
    );
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
  text[], text[], text[], text[], text[], bigint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_jumia_self_authorization_ordered(
  uuid, text, text, timestamptz, timestamptz,
  text[], text[], text[], text[], text[], bigint
) TO authenticated;
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
      'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to rotate Jumia credentials'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 32768
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

REVOKE ALL ON FUNCTION public.claim_jumia_authorization_refresh_lease(
  uuid, uuid, bigint, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_jumia_authorization_refresh_lease(
  uuid, uuid, bigint, integer
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid, text, timestamptz, bigint, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_jumia_authorization_credentials(
  uuid, text, timestamptz, bigint, uuid
) TO authenticated, service_role;
