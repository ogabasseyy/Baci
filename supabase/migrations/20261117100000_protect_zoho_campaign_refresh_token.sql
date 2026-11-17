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

-- Backfill logic lives in two small functions so the replay test can run the real thing.
-- (Do not use E'\v' to trim: PostgreSQL reads it as the letter v, which would corrupt
-- tokens that start or end with v.)
CREATE OR REPLACE FUNCTION private.zoho_refresh_token_from_custom_settings_v1(
  p_custom_settings jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- First candidate that is a JSON string with non-whitespace content (ASCII whitespace,
  -- no-break space and BOM trimmed, like JavaScript's trim for real tokens). Non-string
  -- values are ignored, as in the API extractor.
  SELECT x.token
  FROM (VALUES
    (1, p_custom_settings -> 'zohoCampaigns' -> 'refreshToken'),
    (2, p_custom_settings -> 'zohoCampaigns' -> 'refresh_token'),
    (3, p_custom_settings -> 'zoho_campaigns' -> 'refreshToken'),
    (4, p_custom_settings -> 'zoho_campaigns' -> 'refresh_token')
  ) AS cand (ord, val)
  CROSS JOIN LATERAL (
    SELECT NULLIF(
      pg_catalog.regexp_replace(
        CASE WHEN pg_catalog.jsonb_typeof(cand.val) = 'string' THEN cand.val #>> '{}' END,
        '^[[:space:]\u00a0\ufeff]+|[[:space:]\u00a0\ufeff]+$',
        '',
        'g'
      ),
      ''
    ) AS token
  ) AS x
  WHERE x.token IS NOT NULL
  ORDER BY cand.ord
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.strip_zoho_secrets_from_custom_settings_v1(
  p_custom_settings jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_custom_settings
    || CASE
      WHEN pg_catalog.jsonb_typeof(p_custom_settings -> 'zohoCampaigns') = 'object'
        THEN pg_catalog.jsonb_build_object(
          'zohoCampaigns',
          (p_custom_settings -> 'zohoCampaigns') - ARRAY[
            'accessToken', 'access_token', 'clientSecret', 'client_secret',
            'refreshToken', 'refresh_token'
          ]
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN pg_catalog.jsonb_typeof(p_custom_settings -> 'zoho_campaigns') = 'object'
        THEN pg_catalog.jsonb_build_object(
          'zoho_campaigns',
          (p_custom_settings -> 'zoho_campaigns') - ARRAY[
            'accessToken', 'access_token', 'clientSecret', 'client_secret',
            'refreshToken', 'refresh_token'
          ]
        )
      ELSE '{}'::jsonb
    END;
$$;

REVOKE ALL ON FUNCTION private.zoho_refresh_token_from_custom_settings_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.strip_zoho_secrets_from_custom_settings_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

-- The one-time backfill (copy the token, then strip the keys) is a function so the replay
-- test can run the real statements against a seeded legacy row.
CREATE OR REPLACE FUNCTION private.backfill_zoho_campaign_credentials_v1()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.merchant_zoho_campaign_credentials (merchant_id, refresh_token)
  SELECT src.merchant_id, src.token
  FROM (
    SELECT
      fs.merchant_id,
      private.zoho_refresh_token_from_custom_settings_v1(fs.custom_settings) AS token
    FROM public.merchant_feature_settings AS fs
  ) AS src
  JOIN public.merchants AS m ON m.id = src.merchant_id
  WHERE src.token IS NOT NULL
  ON CONFLICT (merchant_id) DO NOTHING;

  -- merchant_feature_settings changes are audited, and the audit writer rejects a database
  -- session that has no actor. Attribute this one-time cleanup to a fixed system principal.
  PERFORM pg_catalog.set_config(
    'app.audit_actor_user_id', '00000000-0000-0000-0000-00000000a2e1', true
  );
  UPDATE public.merchant_feature_settings AS fs
  SET custom_settings = private.strip_zoho_secrets_from_custom_settings_v1(fs.custom_settings)
  WHERE (fs.custom_settings -> 'zohoCampaigns') ?| ARRAY[
      'accessToken', 'access_token', 'clientSecret', 'client_secret',
      'refreshToken', 'refresh_token'
    ]
    OR (fs.custom_settings -> 'zoho_campaigns') ?| ARRAY[
      'accessToken', 'access_token', 'clientSecret', 'client_secret',
      'refreshToken', 'refresh_token'
    ];
END;
$$;

REVOKE ALL ON FUNCTION private.backfill_zoho_campaign_credentials_v1()
  FROM PUBLIC, anon, authenticated;

SELECT private.backfill_zoho_campaign_credentials_v1();

-- Inline CHECK (no helper function): a CHECK function would need an explicit EXECUTE
-- grant for every role that writes this table, and an expression needs none.
ALTER TABLE public.merchant_feature_settings
  ADD CONSTRAINT merchant_feature_settings_no_zoho_secrets
  CHECK (
    NOT (
      COALESCE((custom_settings -> 'zohoCampaigns') ?| ARRAY[
        'accessToken', 'access_token', 'clientSecret', 'client_secret',
        'refreshToken', 'refresh_token'
      ], false)
      OR COALESCE((custom_settings -> 'zoho_campaigns') ?| ARRAY[
        'accessToken', 'access_token', 'clientSecret', 'client_secret',
        'refreshToken', 'refresh_token'
      ], false)
    )
  );

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

-- Audit trail. Before this change a token rotation changed custom_settings, which the
-- feature-settings audit trigger records (presence only). The token now lives in its own
-- table, so it gets its own trigger: configure / rotate / clear, attribution from the
-- canonical writer, and presence flags only (never the token). Created last so the
-- one-time backfill above is not double-audited (its custom_settings cleanup already is).
CREATE OR REPLACE FUNCTION private.audit_merchant_zoho_credential_change_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid := COALESCE(NEW.merchant_id, OLD.merchant_id);
  v_merchant_label text;
  v_writer_capability uuid;
  v_action text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.refresh_token IS NOT DISTINCT FROM NEW.refresh_token THEN
    RETURN NEW;
  END IF;

  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'merchant.zoho_credential.configure'
    WHEN 'DELETE' THEN 'merchant.zoho_credential.clear'
    ELSE 'merchant.zoho_credential.rotate'
  END;

  SELECT NULLIF(pg_catalog.btrim(COALESCE(m.business_name, m.slug)), '')
    INTO v_merchant_label
  FROM public.merchants AS m
  WHERE m.id = v_merchant_id;
  IF v_merchant_label IS NOT NULL AND pg_catalog.char_length(v_merchant_label) > 160 THEN
    v_merchant_label := NULL;
  END IF;

  SELECT capability.capability INTO v_writer_capability
  FROM private.audit_event_writer_capabilities AS capability
  WHERE capability.capability_name = 'canonical_audit_event_writer_v1';
  IF v_writer_capability IS NULL THEN
    RAISE EXCEPTION 'audit_merchant_zoho_credential_writer_capability_unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.write_audit_event_v1(
    v_merchant_id, v_merchant_label, v_action, 'merchant_zoho_credential'::text,
    v_merchant_id::text, ARRAY['refresh_token']::text[],
    pg_catalog.jsonb_build_object(
      'refresh_token', pg_catalog.jsonb_build_object('present', TG_OP <> 'INSERT')
    ),
    pg_catalog.jsonb_build_object(
      'refresh_token', pg_catalog.jsonb_build_object('present', TG_OP <> 'DELETE')
    ),
    NULL::uuid, NULL::uuid, 1::smallint,
    pg_catalog.jsonb_build_object(
      'category', 'merchant_zoho_credential',
      'operation', pg_catalog.lower(TG_OP)
    ),
    v_writer_capability
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION private.audit_merchant_zoho_credential_change_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_merchant_zoho_credential_change_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_merchant_zoho_credential_change_v1
  ON public.merchant_zoho_campaign_credentials;
CREATE TRIGGER audit_merchant_zoho_credential_change_v1
  AFTER INSERT OR DELETE OR UPDATE ON public.merchant_zoho_campaign_credentials
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_merchant_zoho_credential_change_v1();

