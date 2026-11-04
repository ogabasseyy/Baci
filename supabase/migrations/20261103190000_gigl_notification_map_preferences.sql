-- GIG shipment notification map (owner-approved 2026-11-03).
--   * Merchant pushes go to the owner plus staff with orders.fulfill only.
--   * Each merchant event can be muted per merchant (out_for_delivery is OFF
--     by default; every other event is ON until the merchant turns it off).
--   * Customer "shipped" moves from booking to GIG's picked_up event.
--   * Customer cancellations are dropped when a newer live shipment exists.

-- 1. Per-merchant event toggles -------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS shipment_event_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_shipment_event_preferences_object;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_shipment_event_preferences_object
  CHECK (jsonb_typeof(shipment_event_preferences) = 'object') NOT VALID;
COMMENT ON COLUMN public.notification_preferences.shipment_event_preferences IS
  'Per-event merchant GIG shipment push toggles keyed pickup_scheduled, pickup_delayed, picked_up, out_for_delivery, delivered, failed, returned, cancelled. Missing key = default (on, except out_for_delivery which is off).';

-- One atomic write for the shipment toggles plus any ordinary preference
-- fields, so a combined PATCH either fully applies or not at all. SECURITY
-- DEFINER with an explicit check so staff with settings.edit (whom the route
-- authorises) can save, as well as the owner.
CREATE OR REPLACE FUNCTION public.merge_shipment_event_preferences(
  p_merchant_id uuid, p_patch jsonb, p_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'settings', 'edit'
    )
  THEN
    RAISE EXCEPTION 'not authorized to edit notification preferences'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR EXISTS (
      SELECT 1 FROM jsonb_each(p_patch) AS entry(key, value)
      WHERE entry.key NOT IN (
        'pickup_scheduled', 'pickup_delayed', 'picked_up', 'out_for_delivery',
        'delivered', 'failed', 'returned', 'cancelled', 'waybill_changed'
      ) OR jsonb_typeof(entry.value) <> 'boolean'
    )
    OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
    OR EXISTS (
      SELECT 1 FROM jsonb_each(p_fields) AS entry(key, value)
      WHERE entry.key NOT IN (
        'in_app_enabled', 'banner_enabled', 'follow_up_notifications_enabled',
        'quiet_hours_start', 'quiet_hours_end', 'quiet_hours_time_zone'
      )
      OR (entry.key IN ('in_app_enabled', 'banner_enabled', 'follow_up_notifications_enabled')
          AND jsonb_typeof(entry.value) <> 'boolean')
      OR (entry.key IN ('quiet_hours_start', 'quiet_hours_end')
          AND jsonb_typeof(entry.value) NOT IN ('string', 'null'))
      OR (entry.key = 'quiet_hours_time_zone' AND jsonb_typeof(entry.value) <> 'string')
    )
  THEN
    RAISE EXCEPTION 'invalid notification preferences'
      USING ERRCODE = '22023';
  END IF;
  -- Mirror the route schema: quiet hours are set (or cleared) as a pair.
  IF (p_fields ? 'quiet_hours_start') <> (p_fields ? 'quiet_hours_end')
    OR (
      p_fields ? 'quiet_hours_start'
      AND ((p_fields ->> 'quiet_hours_start') IS NULL)
        <> ((p_fields ->> 'quiet_hours_end') IS NULL)
    )
  THEN
    RAISE EXCEPTION 'quiet hours start and end must be set together'
      USING ERRCODE = '22023';
  END IF;
  -- Mirror the route schema: a real IANA zone and HH:MM[:SS] times.
  IF (p_fields ? 'quiet_hours_time_zone' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names AS zone
        WHERE zone.name = p_fields ->> 'quiet_hours_time_zone'
      ))
    OR (p_fields ->> 'quiet_hours_start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
    OR (p_fields ->> 'quiet_hours_end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
  THEN
    RAISE EXCEPTION 'invalid quiet hours'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notification_preferences AS preferences (
    merchant_id, shipment_event_preferences, in_app_enabled, banner_enabled,
    follow_up_notifications_enabled, quiet_hours_start, quiet_hours_end,
    quiet_hours_time_zone, updated_at
  ) VALUES (
    p_merchant_id, p_patch,
    coalesce((p_fields ->> 'in_app_enabled')::boolean, true),
    coalesce((p_fields ->> 'banner_enabled')::boolean, true),
    coalesce((p_fields ->> 'follow_up_notifications_enabled')::boolean, true),
    (p_fields ->> 'quiet_hours_start')::time,
    (p_fields ->> 'quiet_hours_end')::time,
    coalesce(p_fields ->> 'quiet_hours_time_zone', 'Africa/Lagos'),
    now()
  )
  ON CONFLICT (merchant_id) DO UPDATE
  SET shipment_event_preferences =
        preferences.shipment_event_preferences || EXCLUDED.shipment_event_preferences,
      in_app_enabled = CASE WHEN p_fields ? 'in_app_enabled'
        THEN EXCLUDED.in_app_enabled ELSE preferences.in_app_enabled END,
      banner_enabled = CASE WHEN p_fields ? 'banner_enabled'
        THEN EXCLUDED.banner_enabled ELSE preferences.banner_enabled END,
      follow_up_notifications_enabled = CASE WHEN p_fields ? 'follow_up_notifications_enabled'
        THEN EXCLUDED.follow_up_notifications_enabled
        ELSE preferences.follow_up_notifications_enabled END,
      quiet_hours_start = CASE WHEN p_fields ? 'quiet_hours_start'
        THEN EXCLUDED.quiet_hours_start ELSE preferences.quiet_hours_start END,
      quiet_hours_end = CASE WHEN p_fields ? 'quiet_hours_end'
        THEN EXCLUDED.quiet_hours_end ELSE preferences.quiet_hours_end END,
      quiet_hours_time_zone = CASE WHEN p_fields ? 'quiet_hours_time_zone'
        THEN EXCLUDED.quiet_hours_time_zone ELSE preferences.quiet_hours_time_zone END,
      updated_at = now()
  RETURNING jsonb_build_object(
    'merchant_id', preferences.merchant_id,
    'in_app_enabled', preferences.in_app_enabled,
    'banner_enabled', preferences.banner_enabled,
    'follow_up_notifications_enabled', preferences.follow_up_notifications_enabled,
    'shipment_event_preferences', preferences.shipment_event_preferences,
    'quiet_hours_start', preferences.quiet_hours_start,
    'quiet_hours_end', preferences.quiet_hours_end,
    'quiet_hours_time_zone', preferences.quiet_hours_time_zone,
    'updated_at', preferences.updated_at
  ) INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_shipment_event_preferences(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_shipment_event_preferences(uuid, jsonb, jsonb)
  TO authenticated, service_role;

-- Staff-authorised read of the same row (the table policy is owner-only).
CREATE OR REPLACE FUNCTION public.get_notification_preferences(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'dashboard', 'view'
    )
  THEN
    RAISE EXCEPTION 'not authorized to read notification preferences'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'merchant_id', preferences.merchant_id,
      'in_app_enabled', preferences.in_app_enabled,
      'banner_enabled', preferences.banner_enabled,
      'follow_up_notifications_enabled', preferences.follow_up_notifications_enabled,
      'shipment_event_preferences', preferences.shipment_event_preferences,
      'quiet_hours_start', preferences.quiet_hours_start,
      'quiet_hours_end', preferences.quiet_hours_end,
      'quiet_hours_time_zone', preferences.quiet_hours_time_zone,
      'updated_at', preferences.updated_at
    )
    FROM public.notification_preferences AS preferences
    WHERE preferences.merchant_id = p_merchant_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_notification_preferences(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences(uuid)
  TO authenticated, service_role;
