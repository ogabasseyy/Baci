BEGIN;

-- For unmanaged scheduled posts (no active reservation), charge daily capacity to
-- the current published_at date rather than stale requested_publish_at when rescheduled.
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
          AND COALESCE(p.published_at, p.requested_publish_at) IS NOT NULL THEN
          (COALESCE(p.published_at, p.requested_publish_at) AT TIME ZONE 'Africa/Lagos')::date
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

COMMIT;
