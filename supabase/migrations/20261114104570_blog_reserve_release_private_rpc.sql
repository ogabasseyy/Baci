BEGIN;

CREATE OR REPLACE FUNCTION private.reserve_merchant_blog_release_v1(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_id text := NULLIF(pg_catalog.btrim(COALESCE(p_request_id, '')), '');
  v_policy_version text := NULLIF(pg_catalog.btrim(COALESCE(p_policy_version, '')), '');
  v_existing_log private.blog_release_requests%ROWTYPE;
  v_existing_req private.blog_release_reservations%ROWTYPE;
  v_post public.blog_posts%ROWTYPE;
  v_lagos_date date;
  v_inserted private.blog_release_reservations%ROWTYPE;
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL
     OR p_article_identity IS NULL
     OR p_requested_publish_at IS NULL
     OR v_request_id IS NULL
     OR pg_catalog.char_length(v_request_id) > 200
     OR p_payload_digest IS NULL
     OR p_payload_digest !~ '^[a-f0-9]{64}$'
     OR v_policy_version IS NULL
     OR pg_catalog.char_length(v_policy_version) > 80
     OR p_release_class IS NULL
     OR p_release_class NOT IN ('evergreen', 'fast_track_news', 'standard')
     OR p_daily_cap IS NULL OR p_daily_cap < 0
     OR p_evergreen_min_reserve IS NULL OR p_evergreen_min_reserve < 0
     OR p_min_spacing_minutes IS NULL OR p_min_spacing_minutes < 0
     OR p_window_start_hour IS NULL OR p_window_start_hour NOT BETWEEN 0 AND 23
     OR p_window_end_hour IS NULL OR p_window_end_hour NOT BETWEEN 0 AND 23
     OR p_window_end_hour < p_window_start_hour THEN
    RAISE EXCEPTION 'invalid_release_reservation_input' USING ERRCODE = '22023';
  END IF;

  IF p_fast_track_cap IS NULL OR p_fast_track_cap NOT BETWEEN 0 AND 2 THEN
    RAISE EXCEPTION 'invalid_fast_track_cap' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

  SELECT * INTO v_existing_log
  FROM private.blog_release_requests AS rl
  WHERE rl.merchant_id = p_merchant_id
    AND rl.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_log.operation <> 'reserve'
       OR v_existing_log.payload_digest IS DISTINCT FROM p_payload_digest
       OR v_existing_log.post_id IS DISTINCT FROM p_post_id
       OR v_existing_log.article_identity IS DISTINCT FROM p_article_identity THEN
      RAISE EXCEPTION 'reservation_request_payload_mismatch' USING ERRCODE = '40001';
    END IF;

    SELECT * INTO v_existing_req
    FROM private.blog_release_reservations AS r
    WHERE r.id = v_existing_log.reservation_id
      AND r.merchant_id = p_merchant_id;

    SELECT * INTO v_post
    FROM public.blog_posts AS p
    WHERE p.id = v_existing_req.post_id
      AND p.merchant_id = p_merchant_id;

    RETURN private.format_blog_release_reservation_v1(
      v_existing_req,
      v_post.status,
      true,
      false
    );
  END IF;

  SELECT * INTO v_existing_req
  FROM private.blog_release_reservations AS r
  WHERE r.merchant_id = p_merchant_id
    AND r.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_req.payload_digest IS DISTINCT FROM p_payload_digest
       OR v_existing_req.post_id IS DISTINCT FROM p_post_id
       OR v_existing_req.article_identity IS DISTINCT FROM p_article_identity THEN
      RAISE EXCEPTION 'reservation_request_payload_mismatch' USING ERRCODE = '40001';
    END IF;

    SELECT * INTO v_post
    FROM public.blog_posts AS p
    WHERE p.id = v_existing_req.post_id
      AND p.merchant_id = p_merchant_id;

    RETURN private.format_blog_release_reservation_v1(
      v_existing_req,
      v_post.status,
      true,
      false
    );
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

  IF v_post.article_identity IS NOT NULL
     AND v_post.article_identity IS DISTINCT FROM p_article_identity THEN
    RAISE EXCEPTION 'article_identity_conflict' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.blog_posts AS other
    WHERE other.merchant_id = p_merchant_id
      AND other.article_identity = p_article_identity
      AND other.id <> p_post_id
  ) THEN
    RAISE EXCEPTION 'article_identity_already_assigned' USING ERRCODE = '23505';
  END IF;

  IF v_post.status = 'published' THEN
    RAISE EXCEPTION 'blog_post_already_published' USING ERRCODE = '40001';
  END IF;

  IF v_post.status = 'archived' THEN
    RAISE EXCEPTION 'blog_post_archived' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.blog_release_reservations AS active_res
    WHERE active_res.merchant_id = p_merchant_id
      AND active_res.state IN ('reserved', 'deferred')
      AND (
        active_res.post_id = p_post_id
        OR active_res.article_identity = p_article_identity
      )
  ) THEN
    RAISE EXCEPTION 'active_reservation_already_exists' USING ERRCODE = '40001';
  END IF;

  v_lagos_date := private.assert_blog_release_slot_available_v1(
    p_merchant_id,
    p_post_id,
    p_requested_publish_at,
    p_release_class,
    COALESCE(p_is_low_demand_game_software, false),
    p_event_published_at,
    p_daily_cap,
    p_fast_track_cap,
    p_evergreen_min_reserve,
    p_min_spacing_minutes,
    p_window_start_hour,
    p_window_end_hour
  );

  INSERT INTO private.blog_release_reservations (
    merchant_id,
    post_id,
    article_identity,
    request_id,
    payload_digest,
    policy_version,
    release_class,
    task_type,
    category,
    is_low_demand_game_software,
    requested_publish_at,
    reserved_lagos_date,
    event_published_at,
    daily_cap,
    fast_track_cap,
    evergreen_min_reserve,
    min_spacing_minutes,
    window_start_hour,
    window_end_hour,
    state
  )
  VALUES (
    p_merchant_id,
    p_post_id,
    p_article_identity,
    v_request_id,
    p_payload_digest,
    v_policy_version,
    p_release_class,
    NULLIF(pg_catalog.btrim(COALESCE(p_task_type, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_category, '')), ''),
    COALESCE(p_is_low_demand_game_software, false),
    p_requested_publish_at,
    v_lagos_date,
    p_event_published_at,
    p_daily_cap,
    p_fast_track_cap,
    p_evergreen_min_reserve,
    p_min_spacing_minutes,
    p_window_start_hour,
    p_window_end_hour,
    'reserved'
  )
  RETURNING * INTO v_inserted;

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
    v_inserted.id,
    'reserve',
    p_post_id,
    p_article_identity,
    p_payload_digest
  );

  PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', p_post_id::text, true);

  UPDATE public.blog_posts
  SET
    article_identity = COALESCE(article_identity, p_article_identity),
    status = 'scheduled',
    published_at = p_requested_publish_at,
    requested_publish_at = p_requested_publish_at
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
  RETURNING * INTO v_post;

  PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', '', true);

  RETURN private.format_blog_release_reservation_v1(
    v_inserted,
    v_post.status,
    false,
    false
  );
END;
$$;

ALTER FUNCTION private.reserve_merchant_blog_release_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reserve_merchant_blog_release_v1(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, boolean, timestamptz, integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
