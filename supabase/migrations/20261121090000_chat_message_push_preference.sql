-- Merchant switch for push alerts about new customer chat messages.
-- Stored on the existing per-merchant notification_preferences row (owner-only
-- table policy unchanged). Default ON so existing merchants keep their alerts.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS chat_message_push_enabled boolean
  NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.chat_message_push_enabled IS
  'Whether a new customer chat message sends a push to the merchant app devices.';

-- Narrow boolean read, same shape as get_follow_up_notification_preference:
-- the chat webhook (no merchant session) and the dashboard both need one bit.
CREATE OR REPLACE FUNCTION public.get_chat_message_push_preference(
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT preference.chat_message_push_enabled
      FROM public.notification_preferences AS preference
      WHERE preference.merchant_id = p_merchant_id
    ),
    TRUE
  );
$$;

ALTER FUNCTION public.get_chat_message_push_preference(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chat_message_push_preference(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_message_push_preference(uuid)
  TO anon, authenticated, service_role;

-- Permission-checked write: the owner or staff with settings.edit, nobody else.
CREATE OR REPLACE FUNCTION public.set_chat_message_push_preference(
  p_merchant_id uuid,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    merchant_id, chat_message_push_enabled, updated_at
  ) VALUES (p_merchant_id, p_enabled, now())
  ON CONFLICT (merchant_id) DO UPDATE
  SET chat_message_push_enabled = EXCLUDED.chat_message_push_enabled,
      updated_at = now();
  RETURN p_enabled;
END;
$$;

ALTER FUNCTION public.set_chat_message_push_preference(uuid, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_chat_message_push_preference(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chat_message_push_preference(uuid, boolean)
  TO authenticated, service_role;
