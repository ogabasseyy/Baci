BEGIN;

CREATE OR REPLACE FUNCTION private.assert_blog_release_slot_available_v1(
  p_merchant_id uuid,
  p_exclude_post_id uuid,
  p_target_publish_at timestamptz,
  p_release_class text,
  p_is_low_demand_game_software boolean,
  p_event_published_at timestamptz,
  p_daily_cap integer,
  p_fast_track_cap integer,
  p_evergreen_min_reserve integer,
  p_min_spacing_minutes integer,
  p_window_start_hour integer,
  p_window_end_hour integer
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_lagos_ts timestamp := p_target_publish_at AT TIME ZONE 'Africa/Lagos';
  v_lagos_date date := v_lagos_ts::date;
  v_lagos_time time := v_lagos_ts::time;
  v_capacity_error text;
  v_has_spacing_conflict boolean := false;
BEGIN
  IF p_release_class = 'fast_track_news' THEN
    IF p_event_published_at IS NULL THEN
      RAISE EXCEPTION 'fast_track_event_timestamp_required' USING ERRCODE = '22023';
    END IF;
    IF p_event_published_at > v_now THEN
      RAISE EXCEPTION 'fast_track_event_in_future' USING ERRCODE = '22023';
    END IF;
    IF p_event_published_at < v_now - interval '12 hours' THEN
      RAISE EXCEPTION 'fast_track_news_expired' USING ERRCODE = '22023';
    END IF;
    IF v_lagos_time < pg_catalog.make_time(p_window_start_hour, 0, 0)
       OR v_lagos_time > pg_catalog.make_time(p_window_end_hour, 0, 0) THEN
      RAISE EXCEPTION 'fast_track_outside_lagos_window' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_capacity_error := private.check_blog_release_capacity_reason_v1(
    p_merchant_id,
    v_lagos_date,
    p_exclude_post_id,
    p_release_class,
    p_is_low_demand_game_software,
    p_daily_cap,
    p_fast_track_cap,
    p_evergreen_min_reserve
  );
  IF v_capacity_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_capacity_error USING ERRCODE = 'P0001';
  END IF;

  IF p_min_spacing_minutes > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.blog_posts AS other
      WHERE other.merchant_id = p_merchant_id
        AND other.is_platform_post IS NOT TRUE
        AND other.id IS DISTINCT FROM p_exclude_post_id
        AND (
          (other.status = 'published' AND other.published_at IS NOT NULL)
          OR (other.status = 'scheduled' AND COALESCE(other.published_at, other.requested_publish_at) IS NOT NULL)
        )
        AND pg_catalog.abs(
          EXTRACT(
            EPOCH FROM (
              p_target_publish_at - CASE
                WHEN other.status = 'published' THEN other.published_at
                ELSE COALESCE(other.published_at, other.requested_publish_at)
              END
            )
          )
        ) < (p_min_spacing_minutes * 60)
    )
    INTO v_has_spacing_conflict;

    IF v_has_spacing_conflict THEN
      RAISE EXCEPTION 'min_spacing_conflict' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_lagos_date;
END;
$$;

ALTER FUNCTION private.assert_blog_release_slot_available_v1(
  uuid, uuid, timestamptz, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_blog_release_slot_available_v1(
  uuid, uuid, timestamptz, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
