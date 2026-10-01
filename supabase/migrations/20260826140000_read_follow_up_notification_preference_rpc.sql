-- Storefront checkout needs a single preference bit to decide whether an
-- invoice follow-up push should be sent. Keep the read boundary narrow so the
-- guest checkout path never receives service-role table access.
CREATE OR REPLACE FUNCTION public.get_follow_up_notification_preference(
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
      SELECT preference.follow_up_notifications_enabled
      FROM public.notification_preferences AS preference
      WHERE preference.merchant_id = p_merchant_id
    ),
    TRUE
  );
$$;

ALTER FUNCTION public.get_follow_up_notification_preference(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_follow_up_notification_preference(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_up_notification_preference(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_follow_up_notification_preference(uuid) IS
  'Returns only the merchant follow-up alert switch for guest invoice notification gating.';
