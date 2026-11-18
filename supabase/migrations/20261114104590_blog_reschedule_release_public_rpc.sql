BEGIN;

CREATE OR REPLACE FUNCTION public.reschedule_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_new_requested_publish_at timestamptz,
  p_request_id text DEFAULT NULL,
  p_daily_cap integer DEFAULT NULL,
  p_fast_track_cap integer DEFAULT NULL,
  p_evergreen_min_reserve integer DEFAULT NULL,
  p_min_spacing_minutes integer DEFAULT NULL,
  p_window_start_hour integer DEFAULT NULL,
  p_window_end_hour integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.reschedule_merchant_blog_release_v1(
    p_merchant_id,
    p_post_id,
    p_new_requested_publish_at,
    p_request_id,
    p_daily_cap,
    p_fast_track_cap,
    p_evergreen_min_reserve,
    p_min_spacing_minutes,
    p_window_start_hour,
    p_window_end_hour
  );
$$;

ALTER FUNCTION public.reschedule_merchant_blog_release_v1(
  uuid, uuid, timestamptz, text, integer, integer, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reschedule_merchant_blog_release_v1(
  uuid, uuid, timestamptz, text, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_merchant_blog_release_v1(
  uuid, uuid, timestamptz, text, integer, integer, integer, integer, integer, integer
) TO authenticated, service_role;

-- 5e. recover_abandoned_blog_release_reservations_v1

COMMIT;
