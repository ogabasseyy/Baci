-- Follow-up to audit R2: Zoho Campaigns tokens lived inside
-- merchant_feature_settings.custom_settings (jsonb), which every active staff
-- member of a store can read through the data API. Column grants cannot hide a
-- key inside a jsonb column that other settings share, so the refresh token
-- moves to its own table that signed-in users cannot read at all.
--
-- Access afterwards:
--   * table: no privileges for anon/authenticated, service_role only;
--   * read:  get_merchant_zoho_refresh_token(merchant) for the owner, staff
--            with marketing create/edit or integrations.manage (they are the
--            people who trigger campaign sends), or the server role;
--   * write: set_merchant_zoho_refresh_token(merchant, token) for the owner or
--            staff with integrations.manage.
-- custom_settings may no longer carry Zoho token keys (CHECK below).

CREATE TABLE IF NOT EXISTS public.merchant_zoho_campaign_credentials (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants (id) ON DELETE CASCADE,
  refresh_token text NOT NULL
    CONSTRAINT merchant_zoho_refresh_token_length
    CHECK (pg_catalog.length(pg_catalog.btrim(refresh_token)) BETWEEN 1 AND 4096),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.merchant_zoho_campaign_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.merchant_zoho_campaign_credentials
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.merchant_zoho_campaign_credentials TO service_role;

-- Backfill: copy any stored refresh token (camelCase object wins, as in the
-- application parser), then strip every token key from custom_settings.
INSERT INTO public.merchant_zoho_campaign_credentials (merchant_id, refresh_token)
SELECT src.merchant_id, src.token
FROM (
  SELECT
    fs.merchant_id,
    NULLIF(pg_catalog.btrim(COALESCE(
      zoho.obj ->> 'refreshToken',
      zoho.obj ->> 'refresh_token'
    )), '') AS token
  FROM public.merchant_feature_settings AS fs
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN pg_catalog.jsonb_typeof(fs.custom_settings -> 'zohoCampaigns') = 'object'
        THEN fs.custom_settings -> 'zohoCampaigns'
      WHEN pg_catalog.jsonb_typeof(fs.custom_settings -> 'zoho_campaigns') = 'object'
        THEN fs.custom_settings -> 'zoho_campaigns'
    END AS obj
  ) AS zoho
) AS src
JOIN public.merchants AS m ON m.id = src.merchant_id
WHERE src.token IS NOT NULL
ON CONFLICT (merchant_id) DO NOTHING;

UPDATE public.merchant_feature_settings AS fs
SET custom_settings = fs.custom_settings
  || CASE
    WHEN pg_catalog.jsonb_typeof(fs.custom_settings -> 'zohoCampaigns') = 'object'
      THEN pg_catalog.jsonb_build_object(
        'zohoCampaigns',
        (fs.custom_settings -> 'zohoCampaigns') - ARRAY[
          'accessToken', 'access_token', 'clientSecret', 'client_secret',
          'refreshToken', 'refresh_token'
        ]
      )
    ELSE '{}'::jsonb
  END
  || CASE
    WHEN pg_catalog.jsonb_typeof(fs.custom_settings -> 'zoho_campaigns') = 'object'
      THEN pg_catalog.jsonb_build_object(
        'zoho_campaigns',
        (fs.custom_settings -> 'zoho_campaigns') - ARRAY[
          'accessToken', 'access_token', 'clientSecret', 'client_secret',
          'refreshToken', 'refresh_token'
        ]
      )
    ELSE '{}'::jsonb
  END
WHERE (fs.custom_settings -> 'zohoCampaigns') ?| ARRAY[
    'accessToken', 'access_token', 'clientSecret', 'client_secret',
    'refreshToken', 'refresh_token'
  ]
  OR (fs.custom_settings -> 'zoho_campaigns') ?| ARRAY[
    'accessToken', 'access_token', 'clientSecret', 'client_secret',
    'refreshToken', 'refresh_token'
  ];

CREATE OR REPLACE FUNCTION public.custom_settings_has_no_zoho_secrets(
  p_custom_settings jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NOT (
    COALESCE((p_custom_settings -> 'zohoCampaigns') ?| ARRAY[
      'accessToken', 'access_token', 'clientSecret', 'client_secret',
      'refreshToken', 'refresh_token'
    ], false)
    OR COALESCE((p_custom_settings -> 'zoho_campaigns') ?| ARRAY[
      'accessToken', 'access_token', 'clientSecret', 'client_secret',
      'refreshToken', 'refresh_token'
    ], false)
  );
$$;

ALTER TABLE public.merchant_feature_settings
  ADD CONSTRAINT merchant_feature_settings_no_zoho_secrets
  CHECK (public.custom_settings_has_no_zoho_secrets(custom_settings));

CREATE OR REPLACE FUNCTION public.get_merchant_zoho_refresh_token(
  p_merchant_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := COALESCE((SELECT auth.role()), '');
  v_uid uuid := (SELECT auth.uid());
  v_allowed boolean := false;
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_role = 'service_role' THEN
    v_allowed := true;
  ELSIF v_role = 'authenticated' AND v_uid IS NOT NULL THEN
    v_allowed := EXISTS (
        SELECT 1 FROM public.merchants AS m
        WHERE m.id = p_merchant_id AND m.user_id = v_uid
      )
      OR public.check_staff_permission(v_uid, p_merchant_id, 'marketing', 'create')
      OR public.check_staff_permission(v_uid, p_merchant_id, 'marketing', 'edit')
      OR public.check_staff_permission(v_uid, p_merchant_id, 'integrations', 'manage');
  END IF;

  IF NOT v_allowed THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT c.refresh_token
    FROM public.merchant_zoho_campaign_credentials AS c
    WHERE c.merchant_id = p_merchant_id
  );
END;
$$;

ALTER FUNCTION public.get_merchant_zoho_refresh_token(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_merchant_zoho_refresh_token(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_zoho_refresh_token(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_merchant_zoho_refresh_token(
  p_merchant_id uuid,
  p_refresh_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_token text := NULLIF(pg_catalog.btrim(COALESCE(p_refresh_token, '')), '');
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'authenticated'
    OR v_uid IS NULL
    OR p_merchant_id IS NULL
    OR NOT (
      EXISTS (
        SELECT 1 FROM public.merchants AS m
        WHERE m.id = p_merchant_id AND m.user_id = v_uid
      )
      OR public.check_staff_permission(v_uid, p_merchant_id, 'integrations', 'manage')
    ) THEN
    RAISE EXCEPTION 'merchant_not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_token IS NULL THEN
    DELETE FROM public.merchant_zoho_campaign_credentials
    WHERE merchant_id = p_merchant_id;
    RETURN;
  END IF;

  IF pg_catalog.length(v_token) > 4096 THEN
    RAISE EXCEPTION 'invalid_zoho_refresh_token' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.merchant_zoho_campaign_credentials
    (merchant_id, refresh_token, updated_at)
  VALUES (p_merchant_id, v_token, pg_catalog.now())
  ON CONFLICT (merchant_id) DO UPDATE
    SET refresh_token = EXCLUDED.refresh_token,
        updated_at = EXCLUDED.updated_at;
END;
$$;

ALTER FUNCTION public.set_merchant_zoho_refresh_token(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_merchant_zoho_refresh_token(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_merchant_zoho_refresh_token(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.set_merchant_zoho_refresh_token(uuid, text) IS
  'Owner or integrations.manage staff only (signed-in callers). Intentionally not executable by service_role: server tooling writes the table directly.';
