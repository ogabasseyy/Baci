-- Permission-aware RLS bridge and a deliberately public analytics-ID projection.
-- This migration follows the RBAC foundation in 20260805150000.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_has_platform_admin_permission_v1(
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    p_permission
  );
$$;

ALTER FUNCTION public.current_user_has_platform_admin_permission_v1(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_user_has_platform_admin_permission_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_has_platform_admin_permission_v1(text)
  TO authenticated;

DROP POLICY IF EXISTS "Platform admins can read settings"
  ON public.platform_settings;
DROP POLICY IF EXISTS "Platform admins can update settings"
  ON public.platform_settings;

CREATE POLICY platform_settings_permission_read_v1
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('settings.read')
  );

CREATE POLICY platform_settings_permission_update_v1
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('settings.manage')
  )
  WITH CHECK (
    public.current_user_has_platform_admin_permission_v1('settings.manage')
  );

CREATE OR REPLACE FUNCTION private.audit_platform_settings_update_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_changed_fields text[];
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'settings.manage'
  ) THEN
    RAISE EXCEPTION 'platform_settings_manage_required' USING ERRCODE = '42501';
  END IF;

  v_changed_fields := array_remove(ARRAY[
    CASE WHEN NEW.google_analytics_id IS DISTINCT FROM OLD.google_analytics_id THEN 'google_analytics_id' END,
    CASE WHEN NEW.ga4_api_secret IS DISTINCT FROM OLD.ga4_api_secret THEN 'ga4_api_secret' END,
    CASE WHEN NEW.facebook_pixel_id IS DISTINCT FROM OLD.facebook_pixel_id THEN 'facebook_pixel_id' END,
    CASE WHEN NEW.facebook_capi_token IS DISTINCT FROM OLD.facebook_capi_token THEN 'facebook_capi_token' END,
    CASE WHEN NEW.tiktok_pixel_id IS DISTINCT FROM OLD.tiktok_pixel_id THEN 'tiktok_pixel_id' END,
    CASE WHEN NEW.tiktok_access_token IS DISTINCT FROM OLD.tiktok_access_token THEN 'tiktok_access_token' END,
    CASE WHEN NEW.snapchat_pixel_id IS DISTINCT FROM OLD.snapchat_pixel_id THEN 'snapchat_pixel_id' END,
    CASE WHEN NEW.snapchat_capi_token IS DISTINCT FROM OLD.snapchat_capi_token THEN 'snapchat_capi_token' END,
    CASE WHEN NEW.twitter_pixel_id IS DISTINCT FROM OLD.twitter_pixel_id THEN 'twitter_pixel_id' END,
    CASE WHEN NEW.platform_fee_percentage IS DISTINCT FROM OLD.platform_fee_percentage THEN 'platform_fee_percentage' END,
    CASE WHEN NEW.platform_fee_flat IS DISTINCT FROM OLD.platform_fee_flat THEN 'platform_fee_flat' END,
    CASE WHEN NEW.payment_processor_fee_percentage IS DISTINCT FROM OLD.payment_processor_fee_percentage THEN 'payment_processor_fee_percentage' END,
    CASE WHEN NEW.payment_processor_fee_flat IS DISTINCT FROM OLD.payment_processor_fee_flat THEN 'payment_processor_fee_flat' END,
    CASE WHEN NEW.platform_name IS DISTINCT FROM OLD.platform_name THEN 'platform_name' END,
    CASE WHEN NEW.platform_logo_url IS DISTINCT FROM OLD.platform_logo_url THEN 'platform_logo_url' END,
    CASE WHEN NEW.support_email IS DISTINCT FROM OLD.support_email THEN 'support_email' END,
    CASE WHEN NEW.support_phone IS DISTINCT FROM OLD.support_phone THEN 'support_phone' END,
    CASE WHEN NEW.enable_merchant_signups IS DISTINCT FROM OLD.enable_merchant_signups THEN 'enable_merchant_signups' END,
    CASE WHEN NEW.enable_custom_domains IS DISTINCT FROM OLD.enable_custom_domains THEN 'enable_custom_domains' END,
    CASE WHEN NEW.enable_analytics_export IS DISTINCT FROM OLD.enable_analytics_export THEN 'enable_analytics_export' END,
    CASE WHEN NEW.maintenance_mode IS DISTINCT FROM OLD.maintenance_mode THEN 'maintenance_mode' END,
    CASE WHEN NEW.maintenance_message IS DISTINCT FROM OLD.maintenance_message THEN 'maintenance_message' END
  ]::text[], NULL);

  IF cardinality(v_changed_fields) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.platform_audit_events (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    changed_fields,
    metadata
  ) VALUES (
    v_actor_user_id,
    'platform_settings.updated',
    'platform_settings',
    NEW.id::text,
    v_changed_fields,
    pg_catalog.jsonb_build_object(
      'category', 'settings',
      'operation', 'update',
      'result', 'succeeded'
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.audit_platform_settings_update_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_platform_settings_update_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_platform_settings_update_v1
  ON public.platform_settings;
CREATE TRIGGER audit_platform_settings_update_v1
AFTER UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION private.audit_platform_settings_update_v1();

CREATE OR REPLACE FUNCTION public.get_public_platform_analytics_config_v1()
RETURNS TABLE (
  google_analytics_id text,
  facebook_pixel_id text,
  tiktok_pixel_id text,
  snapchat_pixel_id text,
  twitter_pixel_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    settings.google_analytics_id::text,
    settings.facebook_pixel_id::text,
    settings.tiktok_pixel_id::text,
    settings.snapchat_pixel_id::text,
    settings.twitter_pixel_id::text
  FROM public.platform_settings AS settings
  WHERE settings.singleton_key IS TRUE
  ORDER BY settings.updated_at DESC NULLS LAST, settings.id DESC
  LIMIT 1;
$$;

ALTER FUNCTION public.get_public_platform_analytics_config_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_platform_analytics_config_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_platform_analytics_config_v1()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_platform_analytics_config_v1() IS
  'Returns only public analytics identifiers. Secret analytics credentials are intentionally excluded.';

COMMIT;
