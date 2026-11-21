-- The three-way chat alert level and its dashboard functions.
--
-- One setting, three plain choices, written through one permission-checked
-- function: all new messages / only when the assistant hands a chat to a
-- person / off. Setting a level also keeps the push switch from the earlier
-- push-preference migration in step (on unless "off").
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

COMMIT;
