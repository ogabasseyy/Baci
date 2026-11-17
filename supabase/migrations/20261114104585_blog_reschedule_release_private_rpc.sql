BEGIN;

-- 5d. reschedule_merchant_blog_release_v1
CREATE OR REPLACE FUNCTION private.reschedule_merchant_blog_release_v1(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post public.blog_posts%ROWTYPE;
  v_res private.blog_release_reservations%ROWTYPE;
  v_existing_log private.blog_release_requests%ROWTYPE;
  v_request_id text := NULLIF(pg_catalog.btrim(COALESCE(p_request_id, '')), '');
  v_reschedule_digest text := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          '|',
          COALESCE(p_post_id::text, ''),
          COALESCE(
            pg_catalog.to_char(
              p_new_requested_publish_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            ''
          ),
          COALESCE(p_daily_cap::text, '<null>'),
          COALESCE(p_fast_track_cap::text, '<null>'),
          COALESCE(p_evergreen_min_reserve::text, '<null>'),
          COALESCE(p_min_spacing_minutes::text, '<null>'),
          COALESCE(p_window_start_hour::text, '<null>'),
          COALESCE(p_window_end_hour::text, '<null>')
        ),
        'UTF8'
      )
    ),
    'hex'
  );
  v_daily_cap integer;
  v_fast_track_cap integer;
  v_evergreen_min_reserve integer;
  v_min_spacing_minutes integer;
  v_window_start_hour integer;
  v_window_end_hour integer;
  v_new_lagos_date date;
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL OR p_new_requested_publish_at IS NULL THEN
    RAISE EXCEPTION 'invalid_reschedule_input' USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NOT NULL AND pg_catalog.char_length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'invalid_reschedule_input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

  IF v_request_id IS NOT NULL THEN
    SELECT * INTO v_existing_log
    FROM private.blog_release_requests AS rl
    WHERE rl.merchant_id = p_merchant_id
      AND rl.request_id = v_request_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_log.operation <> 'reschedule'
         OR v_existing_log.post_id IS DISTINCT FROM p_post_id
         OR v_existing_log.payload_digest IS DISTINCT FROM v_reschedule_digest THEN
        RAISE EXCEPTION 'reservation_request_payload_mismatch' USING ERRCODE = '40001';
      END IF;

      SELECT * INTO v_res
      FROM private.blog_release_reservations AS r
      WHERE r.id = v_existing_log.reservation_id
        AND r.merchant_id = p_merchant_id;

      SELECT * INTO v_post
      FROM public.blog_posts AS p
      WHERE p.id = p_post_id
        AND p.merchant_id = p_merchant_id;

      RETURN private.format_blog_release_reservation_v1(
        v_res,
        v_post.status,
        true,
        false
      );
    END IF;
  END IF;

  SELECT * INTO v_post
  FROM public.blog_posts AS p
  WHERE p.id = p_post_id
    AND p.merchant_id = p_merchant_id
    AND p.is_platform_post IS NOT TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_post.status = 'published' THEN
    RAISE EXCEPTION 'cannot_reschedule_published_blog_post' USING ERRCODE = '40001';
  END IF;

  IF v_post.status = 'archived' THEN
    RAISE EXCEPTION 'blog_post_archived' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res
  FROM private.blog_release_reservations AS r
  WHERE r.merchant_id = p_merchant_id
    AND r.post_id = p_post_id
    AND r.state IN ('reserved', 'deferred')
  ORDER BY r.updated_at DESC, r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active_reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_daily_cap := COALESCE(p_daily_cap, v_res.daily_cap);
  v_fast_track_cap := COALESCE(p_fast_track_cap, v_res.fast_track_cap);
  v_evergreen_min_reserve := COALESCE(p_evergreen_min_reserve, v_res.evergreen_min_reserve);
  v_min_spacing_minutes := COALESCE(p_min_spacing_minutes, v_res.min_spacing_minutes);
  v_window_start_hour := COALESCE(p_window_start_hour, v_res.window_start_hour);
  v_window_end_hour := COALESCE(p_window_end_hour, v_res.window_end_hour);

  IF v_daily_cap < 0
     OR v_evergreen_min_reserve < 0
     OR v_min_spacing_minutes < 0
     OR v_window_start_hour NOT BETWEEN 0 AND 23
     OR v_window_end_hour NOT BETWEEN 0 AND 23
     OR v_window_end_hour < v_window_start_hour THEN
    RAISE EXCEPTION 'invalid_reschedule_input' USING ERRCODE = '22023';
  END IF;

  IF v_fast_track_cap NOT BETWEEN 0 AND 2 THEN
    RAISE EXCEPTION 'invalid_fast_track_cap' USING ERRCODE = '22023';
  END IF;

  IF v_res.state = 'reserved'
     AND v_res.requested_publish_at = p_new_requested_publish_at
     AND v_res.daily_cap = v_daily_cap
     AND v_res.fast_track_cap = v_fast_track_cap
     AND v_res.evergreen_min_reserve = v_evergreen_min_reserve
     AND v_res.min_spacing_minutes = v_min_spacing_minutes
     AND v_res.window_start_hour = v_window_start_hour
     AND v_res.window_end_hour = v_window_end_hour
     AND v_post.status = 'scheduled'
     AND v_post.published_at = p_new_requested_publish_at THEN
    IF v_request_id IS NOT NULL THEN
      INSERT INTO private.blog_release_requests (
        merchant_id,
        request_id,
        reservation_id,
        operation,
        post_id,
        article_identity,
        payload_digest
      )
      VALUES (
        p_merchant_id,
        v_request_id,
        v_res.id,
        'reschedule',
        p_post_id,
        v_res.article_identity,
        v_reschedule_digest
      )
      ON CONFLICT (merchant_id, request_id) DO NOTHING;
    END IF;

    RETURN private.format_blog_release_reservation_v1(
      v_res,
      v_post.status,
      true,
      false
    );
  END IF;

  v_new_lagos_date := private.assert_blog_release_slot_available_v1(
    p_merchant_id,
    p_post_id,
    p_new_requested_publish_at,
    v_res.release_class,
    v_res.is_low_demand_game_software,
    v_res.event_published_at,
    v_daily_cap,
    v_fast_track_cap,
    v_evergreen_min_reserve,
    v_min_spacing_minutes,
    v_window_start_hour,
    v_window_end_hour
  );

  UPDATE private.blog_release_reservations
  SET
    requested_publish_at = p_new_requested_publish_at,
    reserved_lagos_date = v_new_lagos_date,
    daily_cap = v_daily_cap,
    fast_track_cap = v_fast_track_cap,
    evergreen_min_reserve = v_evergreen_min_reserve,
    min_spacing_minutes = v_min_spacing_minutes,
    window_start_hour = v_window_start_hour,
    window_end_hour = v_window_end_hour,
    state = 'reserved',
    defer_reason = NULL,
    next_evaluation_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  IF v_request_id IS NOT NULL THEN
    INSERT INTO private.blog_release_requests (
      merchant_id,
      request_id,
      reservation_id,
      operation,
      post_id,
      article_identity,
      payload_digest
    )
    VALUES (
      p_merchant_id,
      v_request_id,
      v_res.id,
      'reschedule',
      p_post_id,
      v_res.article_identity,
      v_reschedule_digest
    );
  END IF;

  PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', p_post_id::text, true);

  UPDATE public.blog_posts
  SET
    status = 'scheduled',
    published_at = p_new_requested_publish_at,
    requested_publish_at = p_new_requested_publish_at
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
  RETURNING * INTO v_post;

  PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', '', true);

  RETURN private.format_blog_release_reservation_v1(
    v_res,
    v_post.status,
    false,
    true
  );
END;
$$;

ALTER FUNCTION private.reschedule_merchant_blog_release_v1(
  uuid, uuid, timestamptz, text, integer, integer, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reschedule_merchant_blog_release_v1(
  uuid, uuid, timestamptz, text, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
