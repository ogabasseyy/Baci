-- Store a rotating Jumia Self Authorization grant once and reference it from
-- every selected shop. Credential plaintext is encrypted by application server
-- code before it crosses this database boundary.

CREATE TABLE IF NOT EXISTS public.jumia_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  client_key_hash text NOT NULL,
  credential_ciphertext text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  rotation_version bigint NOT NULL DEFAULT 1 CHECK (rotation_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, merchant_id),
  UNIQUE (merchant_id, client_key_hash),
  CHECK (client_key_hash ~ '^[a-f0-9]{64}$'),
  CHECK (char_length(credential_ciphertext) BETWEEN 32 AND 16384)
);

ALTER TABLE public.jumia_authorizations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.jumia_authorizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jumia_authorizations TO authenticated;

CREATE POLICY jumia_authorizations_select_policy
ON public.jumia_authorizations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = jumia_authorizations.merchant_id
      AND merchant.user_id = (SELECT auth.uid())
  )
  OR public.check_staff_permission(
    (SELECT auth.uid()),
    merchant_id,
    'integrations',
    'view'
  )
);

ALTER TABLE public.marketplace_integrations
  ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS jumia_authorization_id uuid,
  ADD COLUMN IF NOT EXISTS marketplace_key text NOT NULL DEFAULT 'default';

ALTER TABLE public.marketplace_integrations
  DROP CONSTRAINT IF EXISTS marketplace_integrations_merchant_id_platform_shop_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_integrations_merchant_platform_shop_marketplace_key
  ON public.marketplace_integrations(merchant_id, platform, shop_id, marketplace_key);

ALTER TABLE public.marketplace_integrations
  ADD CONSTRAINT marketplace_integrations_connection_method_check
  CHECK (connection_method IN ('oauth', 'self_authorization')),
  ADD CONSTRAINT marketplace_integrations_jumia_authorization_merchant_fkey
  FOREIGN KEY (jumia_authorization_id, merchant_id)
  REFERENCES public.jumia_authorizations(id, merchant_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT marketplace_integrations_jumia_authorization_method_check
  CHECK (
    (connection_method = 'oauth' AND jumia_authorization_id IS NULL)
    OR
    (connection_method = 'self_authorization' AND jumia_authorization_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS marketplace_integrations_jumia_authorization_idx
ON public.marketplace_integrations(jumia_authorization_id)
WHERE jumia_authorization_id IS NOT NULL;

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
    FROM unnest(p_shop_ids) AS selected_shop(shop_id)
    GROUP BY btrim(selected_shop.shop_id)
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
