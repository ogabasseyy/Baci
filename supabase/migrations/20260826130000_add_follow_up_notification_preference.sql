-- Merchants can mute event-driven follow-up alerts without disabling other
-- notification channels. The default keeps existing merchants opted in.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS follow_up_notifications_enabled boolean
  NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.follow_up_notifications_enabled IS
  'Whether event-driven alerts for actionable customer follow-up items are enabled.';
