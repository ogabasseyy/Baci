-- The three-way chat alert level and its dashboard functions.
--
-- One setting, three plain choices, written through one permission-checked
-- function: all new messages / only when the assistant hands a chat to a
-- person / off. The level is the single source of truth, for the dashboard,
-- for the bell and for pushes. The push switch from the earlier push-preference
-- migration is kept in step (on unless "off") and the push gate reads the
-- level, so the two can never disagree about what the merchant will receive.
BEGIN;

-- A store that muted pushes with the earlier push-only switch asked for no
-- pushes; the single level must say so instead of showing "all" while pushes
-- stay off.
UPDATE public.notification_preferences
SET chat_message_notifications = 'off', updated_at = pg_catalog.now()
WHERE chat_message_push_enabled = false
  AND chat_message_notifications <> 'off';

-- Dashboard read: the merchant's current chat alert level. Owner or staff who
-- may view the dashboard; nobody else, so one store's setting is never
-- readable by another.
CREATE OR REPLACE FUNCTION public.get_chat_message_alert_level(
  p_merchant_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'dashboard', 'view'
    )
  THEN
    RAISE EXCEPTION 'not authorized to read notification preferences'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT preference.chat_message_notifications
      FROM public.notification_preferences AS preference
      WHERE preference.merchant_id = p_merchant_id
    ),
    'all'
  );
END;
$$;

ALTER FUNCTION public.get_chat_message_alert_level(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chat_message_alert_level(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_message_alert_level(uuid) TO authenticated, service_role;

-- Dashboard write: the owner or staff with settings.edit, nobody else. The
-- push switch follows the level (on unless "off"), so a choice made here is
-- never undone by an older push-only setting.
CREATE OR REPLACE FUNCTION public.set_chat_message_alert_level(
  p_merchant_id uuid,
  p_level text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_level IS NULL OR p_level NOT IN ('all', 'handover', 'off') THEN
    RAISE EXCEPTION 'level must be all, handover or off' USING ERRCODE = '22023';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'settings', 'edit'
    )
  THEN
    RAISE EXCEPTION 'not authorized to edit notification preferences'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_preferences AS preferences (
    merchant_id, chat_message_notifications, chat_message_push_enabled, updated_at
  ) VALUES (p_merchant_id, p_level, p_level <> 'off', pg_catalog.now())
  ON CONFLICT (merchant_id) DO UPDATE
  SET chat_message_notifications = EXCLUDED.chat_message_notifications,
      chat_message_push_enabled = EXCLUDED.chat_message_push_enabled,
      updated_at = pg_catalog.now();
  RETURN p_level;
END;
$$;

ALTER FUNCTION public.set_chat_message_alert_level(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_chat_message_alert_level(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chat_message_alert_level(uuid, text) TO authenticated, service_role;

-- The push gate follows the level, not the older push-only boolean: "off" is
-- the only level that mutes pushes, and an unreadable or missing preference
-- still means "on" (the caller treats any error the same way).
CREATE OR REPLACE FUNCTION public.get_chat_message_push_preference(
  p_merchant_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (
      SELECT preference.chat_message_notifications <> 'off'
      FROM public.notification_preferences AS preference
      WHERE preference.merchant_id = p_merchant_id
    ),
    TRUE
  );
$$;

-- The older push-only setter stays callable (an older client may still use
-- it) but now moves the level with it, so it cannot leave the level saying
-- "alerts on" while pushes are muted: switching pushes off turns chat alerts
-- off, switching them on restores "all" from "off" and leaves "handover only".
CREATE OR REPLACE FUNCTION public.set_chat_message_push_preference(
  p_merchant_id uuid,
  p_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'settings', 'edit'
    )
  THEN
    RAISE EXCEPTION 'not authorized to edit notification preferences'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_preferences AS preferences (
    merchant_id, chat_message_push_enabled, chat_message_notifications, updated_at
  ) VALUES (
    p_merchant_id, p_enabled, CASE WHEN p_enabled THEN 'all' ELSE 'off' END, pg_catalog.now()
  )
  ON CONFLICT (merchant_id) DO UPDATE
  SET chat_message_push_enabled = EXCLUDED.chat_message_push_enabled,
      chat_message_notifications = CASE
        WHEN NOT EXCLUDED.chat_message_push_enabled THEN 'off'
        WHEN preferences.chat_message_notifications = 'off' THEN 'all'
        ELSE preferences.chat_message_notifications
      END,
      updated_at = pg_catalog.now();
  RETURN p_enabled;
END;
$$;

COMMIT;
