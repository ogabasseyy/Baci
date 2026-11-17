-- Audit R2: keep ad-platform secrets in merchant_feature_settings out of reach
-- of signed-in store users (owners and staff) through the public data API.
--
-- Before: `authenticated` held a table-wide SELECT, and the RLS policy "Unified
-- view access for feature settings" admits the owner AND every active staff
-- member. Any staff member could therefore run
--   GET /merchant_feature_settings?select=facebook_capi_token,ga4_api_secret,...
-- and read the store's Meta, TikTok, Snapchat and GA4 server credentials.
--
-- After: the table-wide SELECT is replaced by a column list that omits the four
-- secrets (same pattern as merchants, 20260722150000). Server-side fan-out keeps
-- reading them through its existing service-role/event-pipeline path, which is
-- not affected by `authenticated` grants. INSERT/UPDATE/DELETE grants are left
-- alone, so owners can still save a new token; they just cannot read it back.
--
-- The dashboard shows "configured / not configured". That needs presence
-- without value, so `get_merchant_integration_secret_presence` returns four
-- booleans to the owner, or to staff holding settings view/edit, marketing or
-- dashboard view permission for that exact merchant (the same gate as the settings route).
--
-- Not changed here (see PR description): `custom_settings` (holds Zoho
-- Campaigns tokens) stays readable, and any column added to this table later
-- needs its own column GRANT. The replay test fails if one is forgotten.

REVOKE SELECT ON TABLE public.merchant_feature_settings
  FROM PUBLIC, anon, authenticated;

DO $grant$
DECLARE
  v_columns text;
BEGIN
  SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.merchant_feature_settings'::pg_catalog.regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname <> ALL (ARRAY[
      'facebook_capi_token',
      'tiktok_access_token',
      'snapchat_capi_token',
      'ga4_api_secret'
    ]);

  EXECUTE pg_catalog.format(
    'GRANT SELECT (%s) ON TABLE public.merchant_feature_settings TO authenticated',
    v_columns
  );
END
$grant$;

CREATE OR REPLACE FUNCTION public.get_merchant_integration_secret_presence(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'authenticated'
    OR (SELECT auth.uid()) IS NULL
    OR p_merchant_id IS NULL
    OR NOT (
      EXISTS (
        SELECT 1 FROM public.merchants AS m
        WHERE m.id = p_merchant_id AND m.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'settings', 'view')
      OR public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'settings', 'edit')
      OR public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'marketing', 'view')
      OR public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'dashboard', 'view')
    ) THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'facebook_capi_token',
      pg_catalog.btrim(COALESCE(fs.facebook_capi_token, '')) <> '',
    'tiktok_access_token',
      pg_catalog.btrim(COALESCE(fs.tiktok_access_token, '')) <> '',
    'snapchat_capi_token',
      pg_catalog.btrim(COALESCE(fs.snapchat_capi_token, '')) <> '',
    'ga4_api_secret',
      pg_catalog.btrim(COALESCE(fs.ga4_api_secret, '')) <> ''
  )
    INTO v_result
  FROM public.merchant_feature_settings AS fs
  WHERE fs.merchant_id = p_merchant_id;

  RETURN COALESCE(
    v_result,
    pg_catalog.jsonb_build_object(
      'facebook_capi_token', false,
      'tiktok_access_token', false,
      'snapchat_capi_token', false,
      'ga4_api_secret', false
    )
  );
END;
$$;

ALTER FUNCTION public.get_merchant_integration_secret_presence(uuid)
  OWNER TO postgres;

COMMENT ON FUNCTION public.get_merchant_integration_secret_presence(uuid) IS
  'Returns only whether each ad-platform secret is set (booleans) for the owner or staff with settings, marketing or dashboard view permission; never the values.';

REVOKE ALL ON FUNCTION public.get_merchant_integration_secret_presence(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_merchant_integration_secret_presence(uuid)
  TO authenticated;

-- Grant-path sweep (Codex review): get_user_merchant_context() is a SECURITY DEFINER
-- function executable by `authenticated` that returned to_jsonb() of the WHOLE
-- merchant_feature_settings row, so any active staff member could still read the four
-- secrets through POST /rpc/get_user_merchant_context even after the column revoke.
-- Rewrite its feature_settings projection in place (same technique as earlier
-- migrations): drop the four secret keys and add `<secret>_configured` booleans, which
-- is exactly the shape the dashboard's redaction helper produced from the raw values.
-- A catalog sweep of production found no other function or view exposing them.
DO $rewrite$
DECLARE
  v_definition text;
  v_needle constant text := 'pg_catalog.to_jsonb(fs)';
  v_replacement constant text :=
    '(pg_catalog.to_jsonb(fs) - ARRAY[''facebook_capi_token'', ''tiktok_access_token'', '
    || '''snapchat_capi_token'', ''ga4_api_secret'']::text[]) || pg_catalog.jsonb_build_object('
    || '''facebook_capi_token_configured'', NULLIF(pg_catalog.btrim(COALESCE(fs.facebook_capi_token, '''')), '''') IS NOT NULL, '
    || '''tiktok_access_token_configured'', NULLIF(pg_catalog.btrim(COALESCE(fs.tiktok_access_token, '''')), '''') IS NOT NULL, '
    || '''snapchat_capi_token_configured'', NULLIF(pg_catalog.btrim(COALESCE(fs.snapchat_capi_token, '''')), '''') IS NOT NULL, '
    || '''ga4_api_secret_configured'', NULLIF(pg_catalog.btrim(COALESCE(fs.ga4_api_secret, '''')), '''') IS NOT NULL)';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef('public.get_user_merchant_context()'::pg_catalog.regprocedure);
  IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle, '')))
       / pg_catalog.length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'get_user_merchant_context feature_settings projection changed; review before rewriting';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_needle, v_replacement);
END
$rewrite$;
