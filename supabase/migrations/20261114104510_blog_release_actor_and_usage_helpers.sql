BEGIN;

-- 3. Private helpers for auth, capacity, spacing, and payload formatting
CREATE OR REPLACE FUNCTION private.assert_blog_release_actor_v1(p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE((SELECT auth.role()), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF COALESCE((SELECT auth.role()), '') = 'authenticated'
     AND (SELECT auth.uid()) IS NOT NULL
     AND public.check_staff_permission(
       (SELECT auth.uid()),
       p_merchant_id,
       'marketing',
       'edit'
     ) IS TRUE THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'blog_release_access_denied' USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION private.assert_blog_release_actor_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_blog_release_actor_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.format_blog_release_reservation_v1(
  p_row private.blog_release_reservations,
  p_post_status text,
  p_idempotent_replay boolean DEFAULT false,
  p_rescheduled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'reservation_id', p_row.id,
    'merchant_id', p_row.merchant_id,
    'post_id', p_row.post_id,
    'article_identity', p_row.article_identity,
    'request_id', p_row.request_id,
    'payload_digest', p_row.payload_digest,
    'policy_version', p_row.policy_version,
    'release_class', p_row.release_class,
    'task_type', p_row.task_type,
    'category', p_row.category,
    'is_low_demand_game_software', p_row.is_low_demand_game_software,
    'state', p_row.state,
    'requested_publish_at', p_row.requested_publish_at,
    'reserved_lagos_date', p_row.reserved_lagos_date,
    'event_published_at', p_row.event_published_at,
    'defer_reason', p_row.defer_reason,
    'next_evaluation_at', p_row.next_evaluation_at,
    'actual_published_at', p_row.actual_published_at,
    'post_status', p_post_status,
    'idempotent_replay', p_idempotent_replay,
    'rescheduled', p_rescheduled
  );
$$;

ALTER FUNCTION private.format_blog_release_reservation_v1(
  private.blog_release_reservations, text, boolean, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.format_blog_release_reservation_v1(
  private.blog_release_reservations, text, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.compute_blog_release_day_usage_v1(
  p_merchant_id uuid,
  p_lagos_date date,
  p_exclude_post_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_used integer,
  evergreen_used integer,
  fast_track_used integer,
  low_demand_game_software_used integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH post_effective AS (
    SELECT
      CASE
        WHEN p.article_identity IS NOT NULL THEN 'article:' || p.article_identity::text
        ELSE 'post:' || p.id::text
      END AS article_key,
      CASE
        WHEN p.status = 'published' AND p.published_at IS NOT NULL THEN
          (p.published_at AT TIME ZONE 'Africa/Lagos')::date
        WHEN p.status = 'scheduled' AND r.id IS NOT NULL THEN
          r.reserved_lagos_date
        WHEN p.status = 'scheduled'
          AND COALESCE(p.requested_publish_at, p.published_at) IS NOT NULL THEN
          (COALESCE(p.requested_publish_at, p.published_at) AT TIME ZONE 'Africa/Lagos')::date
        ELSE NULL
      END AS effective_lagos_date,
      r.release_class AS reservation_release_class,
      COALESCE(r.is_low_demand_game_software, false) AS is_low_demand_game_software
    FROM public.blog_posts AS p
    LEFT JOIN LATERAL (
      SELECT
        res.id,
        res.release_class,
        res.is_low_demand_game_software,
        res.reserved_lagos_date
      FROM private.blog_release_reservations AS res
      WHERE res.merchant_id = p_merchant_id
        AND res.post_id = p.id
        AND (
          (p.status = 'scheduled' AND res.state IN ('reserved', 'deferred'))
          OR (p.status = 'published' AND res.state = 'published')
        )
      ORDER BY res.updated_at DESC, res.created_at DESC
      LIMIT 1
    ) AS r ON true
    WHERE p.merchant_id = p_merchant_id
      AND p.is_platform_post IS NOT TRUE
      AND p.id IS DISTINCT FROM p_exclude_post_id
      AND p.status IN ('scheduled', 'published')
  )
  SELECT
    pg_catalog.count(DISTINCT pe.article_key)::integer,
    pg_catalog.count(DISTINCT pe.article_key) FILTER (
      WHERE pe.reservation_release_class = 'evergreen'
    )::integer,
    pg_catalog.count(DISTINCT pe.article_key) FILTER (
      WHERE pe.reservation_release_class = 'fast_track_news'
    )::integer,
    pg_catalog.count(DISTINCT pe.article_key) FILTER (
      WHERE pe.is_low_demand_game_software IS TRUE
    )::integer
  FROM post_effective AS pe
  WHERE pe.effective_lagos_date = p_lagos_date;
$$;

ALTER FUNCTION private.compute_blog_release_day_usage_v1(uuid, date, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.compute_blog_release_day_usage_v1(uuid, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.check_blog_release_capacity_reason_v1(
  p_merchant_id uuid,
  p_lagos_date date,
  p_exclude_post_id uuid,
  p_release_class text,
  p_is_low_demand_game_software boolean,
  p_daily_cap integer,
  p_fast_track_cap integer,
  p_evergreen_min_reserve integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usage record;
  v_effective_fast_track_cap integer := LEAST(GREATEST(p_fast_track_cap, 0), 2);
BEGIN
  SELECT * INTO v_usage
  FROM private.compute_blog_release_day_usage_v1(
    p_merchant_id,
    p_lagos_date,
    p_exclude_post_id
  );

  IF v_usage.total_used + 1 > p_daily_cap THEN
    RETURN 'daily_cap_exceeded';
  END IF;

  IF p_release_class <> 'evergreen'
     AND (v_usage.total_used + 1 + GREATEST(p_evergreen_min_reserve - v_usage.evergreen_used, 0)) > p_daily_cap THEN
    RETURN 'evergreen_reserve_required';
  END IF;

  IF p_release_class = 'fast_track_news'
     AND v_usage.fast_track_used + 1 > v_effective_fast_track_cap THEN
    RETURN 'fast_track_cap_exceeded';
  END IF;

  IF p_is_low_demand_game_software IS TRUE
     AND v_usage.low_demand_game_software_used + 1 > 1 THEN
    RETURN 'low_demand_game_software_cap_exceeded';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION private.check_blog_release_capacity_reason_v1(
  uuid, date, uuid, text, boolean, integer, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.check_blog_release_capacity_reason_v1(
  uuid, date, uuid, text, boolean, integer, integer, integer
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
