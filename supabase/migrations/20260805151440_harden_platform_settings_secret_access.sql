-- Keep analytics credentials behind explicit platform-settings RPCs.
BEGIN;

REVOKE ALL ON TABLE public.platform_settings FROM anon, authenticated;
REVOKE SELECT (
  ga4_api_secret, facebook_capi_token, tiktok_access_token, snapchat_capi_token
) ON TABLE public.platform_settings FROM anon, authenticated;
REVOKE UPDATE (id, singleton_key, created_at, updated_at)
  ON TABLE public.platform_settings FROM anon, authenticated;
GRANT SELECT (
  id, google_analytics_id, facebook_pixel_id, tiktok_pixel_id,
  snapchat_pixel_id, twitter_pixel_id, platform_fee_percentage,
  platform_fee_flat, payment_processor_fee_percentage,
  payment_processor_fee_flat, platform_name, platform_logo_url,
  support_email, support_phone, enable_merchant_signups,
  enable_custom_domains, enable_analytics_export, maintenance_mode,
  maintenance_message, created_at, updated_at
) ON TABLE public.platform_settings TO authenticated;

ALTER TABLE public.platform_settings
  ALTER COLUMN singleton_key SET NOT NULL;

CREATE OR REPLACE FUNCTION public.get_admin_platform_settings_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_result jsonb;
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id, 'settings.read'
  ) THEN
    RAISE EXCEPTION 'platform_settings_read_required' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'id', settings.id,
    'google_analytics_id', settings.google_analytics_id,
    'facebook_pixel_id', settings.facebook_pixel_id,
    'tiktok_pixel_id', settings.tiktok_pixel_id,
    'snapchat_pixel_id', settings.snapchat_pixel_id,
    'twitter_pixel_id', settings.twitter_pixel_id,
    'platform_fee_percentage', settings.platform_fee_percentage,
    'platform_fee_flat', settings.platform_fee_flat,
    'payment_processor_fee_percentage', settings.payment_processor_fee_percentage,
    'payment_processor_fee_flat', settings.payment_processor_fee_flat,
    'platform_name', settings.platform_name,
    'platform_logo_url', settings.platform_logo_url,
    'support_email', settings.support_email,
    'support_phone', settings.support_phone,
    'enable_merchant_signups', settings.enable_merchant_signups,
    'enable_custom_domains', settings.enable_custom_domains,
    'enable_analytics_export', settings.enable_analytics_export,
    'maintenance_mode', settings.maintenance_mode,
    'maintenance_message', settings.maintenance_message,
    'created_at', settings.created_at,
    'updated_at', settings.updated_at,
    'secretStatus', pg_catalog.jsonb_build_object(
      'ga4_api_secret', NULLIF(pg_catalog.btrim(settings.ga4_api_secret), '') IS NOT NULL,
      'facebook_capi_token', NULLIF(pg_catalog.btrim(settings.facebook_capi_token), '') IS NOT NULL,
      'tiktok_access_token', NULLIF(pg_catalog.btrim(settings.tiktok_access_token), '') IS NOT NULL,
      'snapchat_capi_token', NULLIF(pg_catalog.btrim(settings.snapchat_capi_token), '') IS NOT NULL
    )
  ) INTO v_result
  FROM public.platform_settings AS settings
  WHERE settings.singleton_key IS TRUE;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'platform_settings_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_admin_platform_settings_v1(p_settings jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_input public.platform_settings%ROWTYPE;
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id, 'settings.manage'
  ) THEN
    RAISE EXCEPTION 'platform_settings_manage_required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_settings) <> 'object' OR p_settings = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_platform_settings_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_settings) AS keys(key)
    WHERE key NOT IN (
      'google_analytics_id', 'ga4_api_secret', 'facebook_pixel_id',
      'facebook_capi_token', 'tiktok_pixel_id', 'tiktok_access_token',
      'snapchat_pixel_id', 'snapchat_capi_token', 'twitter_pixel_id',
      'platform_fee_percentage', 'platform_fee_flat',
      'payment_processor_fee_percentage', 'payment_processor_fee_flat',
      'platform_name', 'platform_logo_url', 'support_email', 'support_phone',
      'enable_merchant_signups', 'enable_custom_domains',
      'enable_analytics_export', 'maintenance_mode', 'maintenance_message'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_platform_settings_field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each_text(p_settings) AS setting(key, value)
    WHERE key IN (
      'google_analytics_id', 'facebook_pixel_id', 'tiktok_pixel_id',
      'snapchat_pixel_id', 'twitter_pixel_id'
    )
      AND char_length(btrim(value)) NOT BETWEEN 1 AND 50
  ) OR (
    p_settings ? 'ga4_api_secret'
    AND p_settings -> 'ga4_api_secret' <> 'null'::jsonb
    AND char_length(p_settings ->> 'ga4_api_secret') NOT BETWEEN 1 AND 100
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each_text(p_settings) AS setting(key, value)
    WHERE key IN (
      'facebook_capi_token', 'tiktok_access_token', 'snapchat_capi_token'
    )
      AND char_length(value) NOT BETWEEN 1 AND 4096
  ) THEN
    RAISE EXCEPTION 'invalid_platform_settings_text_length' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_input
  FROM pg_catalog.jsonb_populate_record(NULL::public.platform_settings, p_settings);

  IF (p_settings ? 'platform_fee_percentage' AND (
      v_input.platform_fee_percentage IS NULL
      OR v_input.platform_fee_percentage NOT BETWEEN 0 AND 100
    )) OR (p_settings ? 'payment_processor_fee_percentage' AND (
      v_input.payment_processor_fee_percentage IS NULL
      OR v_input.payment_processor_fee_percentage NOT BETWEEN 0 AND 100
    )) OR (p_settings ? 'platform_fee_flat' AND (
      v_input.platform_fee_flat IS NULL
      OR v_input.platform_fee_flat NOT BETWEEN 0 AND 100000000
    )) OR (p_settings ? 'payment_processor_fee_flat' AND (
      v_input.payment_processor_fee_flat IS NULL
      OR v_input.payment_processor_fee_flat NOT BETWEEN 0 AND 100000000
    )) THEN
    RAISE EXCEPTION 'invalid_platform_settings_fee' USING ERRCODE = '22023';
  END IF;

  IF p_settings ? 'platform_name' AND (
    v_input.platform_name IS NULL
    OR char_length(btrim(v_input.platform_name)) NOT BETWEEN 1 AND 100
  ) THEN
    RAISE EXCEPTION 'invalid_platform_settings_name' USING ERRCODE = '22023';
  END IF;

  IF (p_settings ? 'support_email' AND v_input.support_email IS NOT NULL AND (
      char_length(v_input.support_email) > 254
      OR v_input.support_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )) OR (p_settings ? 'support_phone' AND v_input.support_phone IS NOT NULL AND (
      char_length(btrim(v_input.support_phone)) NOT BETWEEN 1 AND 50
    )) OR (p_settings ? 'platform_logo_url' AND v_input.platform_logo_url IS NOT NULL AND (
      char_length(v_input.platform_logo_url) > 2048
    )) OR (p_settings ? 'maintenance_message' AND v_input.maintenance_message IS NOT NULL AND (
      char_length(btrim(v_input.maintenance_message)) NOT BETWEEN 1 AND 1000
    )) THEN
    RAISE EXCEPTION 'invalid_platform_settings_contact_or_message' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_settings) AS keys(key)
    WHERE key IN (
      'enable_merchant_signups', 'enable_custom_domains',
      'enable_analytics_export', 'maintenance_mode'
    )
      AND p_settings -> key = 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'invalid_platform_settings_boolean' USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_settings AS settings
  SET google_analytics_id = CASE WHEN p_settings ? 'google_analytics_id' THEN v_input.google_analytics_id ELSE settings.google_analytics_id END,
    ga4_api_secret = CASE WHEN p_settings ? 'ga4_api_secret' THEN v_input.ga4_api_secret ELSE settings.ga4_api_secret END,
    facebook_pixel_id = CASE WHEN p_settings ? 'facebook_pixel_id' THEN v_input.facebook_pixel_id ELSE settings.facebook_pixel_id END,
    facebook_capi_token = CASE WHEN p_settings ? 'facebook_capi_token' THEN v_input.facebook_capi_token ELSE settings.facebook_capi_token END,
    tiktok_pixel_id = CASE WHEN p_settings ? 'tiktok_pixel_id' THEN v_input.tiktok_pixel_id ELSE settings.tiktok_pixel_id END,
    tiktok_access_token = CASE WHEN p_settings ? 'tiktok_access_token' THEN v_input.tiktok_access_token ELSE settings.tiktok_access_token END,
    snapchat_pixel_id = CASE WHEN p_settings ? 'snapchat_pixel_id' THEN v_input.snapchat_pixel_id ELSE settings.snapchat_pixel_id END,
    snapchat_capi_token = CASE WHEN p_settings ? 'snapchat_capi_token' THEN v_input.snapchat_capi_token ELSE settings.snapchat_capi_token END,
    twitter_pixel_id = CASE WHEN p_settings ? 'twitter_pixel_id' THEN v_input.twitter_pixel_id ELSE settings.twitter_pixel_id END,
    platform_fee_percentage = CASE WHEN p_settings ? 'platform_fee_percentage' THEN v_input.platform_fee_percentage ELSE settings.platform_fee_percentage END,
    platform_fee_flat = CASE WHEN p_settings ? 'platform_fee_flat' THEN v_input.platform_fee_flat ELSE settings.platform_fee_flat END,
    payment_processor_fee_percentage = CASE WHEN p_settings ? 'payment_processor_fee_percentage' THEN v_input.payment_processor_fee_percentage ELSE settings.payment_processor_fee_percentage END,
    payment_processor_fee_flat = CASE WHEN p_settings ? 'payment_processor_fee_flat' THEN v_input.payment_processor_fee_flat ELSE settings.payment_processor_fee_flat END,
    platform_name = CASE WHEN p_settings ? 'platform_name' THEN v_input.platform_name ELSE settings.platform_name END,
    platform_logo_url = CASE WHEN p_settings ? 'platform_logo_url' THEN v_input.platform_logo_url ELSE settings.platform_logo_url END,
    support_email = CASE WHEN p_settings ? 'support_email' THEN v_input.support_email ELSE settings.support_email END,
    support_phone = CASE WHEN p_settings ? 'support_phone' THEN v_input.support_phone ELSE settings.support_phone END,
    enable_merchant_signups = CASE WHEN p_settings ? 'enable_merchant_signups' THEN v_input.enable_merchant_signups ELSE settings.enable_merchant_signups END,
    enable_custom_domains = CASE WHEN p_settings ? 'enable_custom_domains' THEN v_input.enable_custom_domains ELSE settings.enable_custom_domains END,
    enable_analytics_export = CASE WHEN p_settings ? 'enable_analytics_export' THEN v_input.enable_analytics_export ELSE settings.enable_analytics_export END,
    maintenance_mode = CASE WHEN p_settings ? 'maintenance_mode' THEN v_input.maintenance_mode ELSE settings.maintenance_mode END,
    maintenance_message = CASE WHEN p_settings ? 'maintenance_message' THEN v_input.maintenance_message ELSE settings.maintenance_message END
  WHERE settings.singleton_key IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_settings_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

ALTER FUNCTION public.get_admin_platform_settings_v1() OWNER TO postgres;
ALTER FUNCTION public.update_admin_platform_settings_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_platform_settings_v1() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.update_admin_platform_settings_v1(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_platform_settings_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_platform_settings_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_admin_platform_settings_v1() IS
  'Permission-gated platform settings projection that never returns secret values.';
COMMENT ON FUNCTION public.update_admin_platform_settings_v1(jsonb) IS
  'Permission-gated platform settings writer with an immutable structural boundary.';

COMMIT;
