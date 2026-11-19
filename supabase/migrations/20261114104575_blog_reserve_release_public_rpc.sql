BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_article_identity uuid,
  p_request_id text,
  p_payload_digest text,
  p_policy_version text,
  p_release_class text,
  p_requested_publish_at timestamptz,
  p_task_type text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_is_low_demand_game_software boolean DEFAULT false,
  p_event_published_at timestamptz DEFAULT NULL,
  p_daily_cap integer DEFAULT 3,
  p_fast_track_cap integer DEFAULT 2,
  p_evergreen_min_reserve integer DEFAULT 1,
  p_min_spacing_minutes integer DEFAULT 30,
  p_window_start_hour integer DEFAULT 8,
  p_window_end_hour integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.reserve_merchant_blog_release_v1(
    p_merchant_id,
    p_post_id,
    p_article_identity,
    p_request_id,
    p_payload_digest,
    p_policy_version,
    p_release_class,
    p_requested_publish_at,
    p_task_type,
    p_category,
    p_is_low_demand_game_software,
    p_event_published_at,
    p_daily_cap,
    p_fast_track_cap,
    p_evergreen_min_reserve,
    p_min_spacing_minutes,
    p_window_start_hour,
    p_window_end_hour
  );
$$;

ALTER FUNCTION public.reserve_merchant_blog_release_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_merchant_blog_release_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_blog_release_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) TO authenticated, service_role;

-- 5c. cancel_merchant_blog_release_v1

COMMIT;
