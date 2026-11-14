-- Track 1: Durable blog article identity, requested_publish_at separation,
-- private release reservations, atomic Lagos-day capacity/spacing RPCs,
-- in-place published post preservation, and scheduled publication finalizer.

BEGIN;

-- 1. Durable identity and requested slot columns on public.blog_posts
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS article_identity uuid,
  ADD COLUMN IF NOT EXISTS requested_publish_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_merchant_article_identity_key
  ON public.blog_posts (merchant_id, article_identity)
  WHERE article_identity IS NOT NULL;

COMMENT ON COLUMN public.blog_posts.article_identity IS
  'Immutable per-merchant UUID identifying a single editorial article across retries and legacy adoption.';
COMMENT ON COLUMN public.blog_posts.requested_publish_at IS
  'Originally requested publication timestamp; preserved when blog_posts.published_at records actual DB publication time or deferred evaluation.';

-- 2. Private reservation table
CREATE TABLE IF NOT EXISTS private.blog_release_reservations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  article_identity uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(pg_catalog.btrim(request_id)) BETWEEN 1 AND 200),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL CHECK (char_length(pg_catalog.btrim(policy_version)) BETWEEN 1 AND 80),
  release_class text NOT NULL CHECK (release_class IN ('evergreen', 'fast_track_news', 'standard')),
  task_type text,
  category text,
  is_low_demand_game_software boolean NOT NULL DEFAULT false,
  requested_publish_at timestamptz NOT NULL,
  reserved_lagos_date date NOT NULL,
  event_published_at timestamptz,
  daily_cap integer NOT NULL CHECK (daily_cap >= 0),
  fast_track_cap integer NOT NULL CHECK (fast_track_cap BETWEEN 0 AND 2),
  evergreen_min_reserve integer NOT NULL CHECK (evergreen_min_reserve >= 0),
  min_spacing_minutes integer NOT NULL DEFAULT 30 CHECK (min_spacing_minutes >= 0),
  window_start_hour integer NOT NULL DEFAULT 8 CHECK (window_start_hour BETWEEN 0 AND 23),
  window_end_hour integer NOT NULL DEFAULT 20 CHECK (
    window_end_hour BETWEEN 0 AND 23 AND window_end_hour >= window_start_hour
  ),
  state text NOT NULL CHECK (
    state IN ('reserved', 'published', 'cancelled', 'deferred', 'held_expired_news')
  ),
  defer_reason text,
  next_evaluation_at timestamptz,
  actual_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT blog_release_reservations_post_merchant_fkey
    FOREIGN KEY (post_id, merchant_id)
    REFERENCES public.blog_posts(id, merchant_id)
    ON DELETE CASCADE,
  CONSTRAINT blog_release_reservations_merchant_request_key
    UNIQUE (merchant_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_release_reservations_active_post_key
  ON private.blog_release_reservations (merchant_id, post_id)
  WHERE state IN ('reserved', 'deferred');

CREATE UNIQUE INDEX IF NOT EXISTS blog_release_reservations_active_identity_key
  ON private.blog_release_reservations (merchant_id, article_identity)
  WHERE state IN ('reserved', 'deferred');

CREATE INDEX IF NOT EXISTS blog_release_reservations_merchant_date_state_idx
  ON private.blog_release_reservations (merchant_id, reserved_lagos_date, state);

CREATE INDEX IF NOT EXISTS blog_release_reservations_post_idx
  ON private.blog_release_reservations (post_id, state);

ALTER TABLE private.blog_release_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.blog_release_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.blog_release_reservations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.blog_release_requests (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (char_length(pg_catalog.btrim(request_id)) BETWEEN 1 AND 200),
  reservation_id uuid NOT NULL REFERENCES private.blog_release_reservations(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('reserve', 'reschedule')),
  post_id uuid NOT NULL,
  article_identity uuid NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (merchant_id, request_id)
);

CREATE INDEX IF NOT EXISTS blog_release_requests_reservation_idx
  ON private.blog_release_requests (reservation_id);

ALTER TABLE private.blog_release_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.blog_release_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.blog_release_requests
  FROM PUBLIC, anon, authenticated, service_role;

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

-- 4. Triggers on public.blog_posts
-- Runs BEFORE guard_blog_post_identity_and_publication_v1 (alphabetically 'f' < 'g')
CREATE OR REPLACE FUNCTION private.finalize_scheduled_blog_post_publication_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_now_lagos timestamp := v_now AT TIME ZONE 'Africa/Lagos';
  v_now_lagos_date date := v_now_lagos::date;
  v_now_lagos_time time := v_now_lagos::time;
  v_res private.blog_release_reservations%ROWTYPE;
  v_has_active_res boolean := false;
  v_blocking_published_at timestamptz;
  v_capacity_reason text;
  v_next_eval timestamptz;
  v_next_lagos timestamp;
  v_next_lagos_date date;
  v_reserved_lagos_date date;
  v_hop integer := 0;
  v_defer_reason text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'scheduled' OR NEW.status IS DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  NEW.requested_publish_at := COALESCE(
    NEW.requested_publish_at,
    OLD.requested_publish_at,
    OLD.published_at
  );

  IF NEW.is_platform_post IS TRUE OR NEW.merchant_id IS NULL THEN
    NEW.published_at := v_now;
    RETURN NEW;
  END IF;

  -- Probe without row locks first so non-blocking advisory lock avoids any
  -- lock-order inversion between batch UPDATE and RPCs.
  SELECT EXISTS (
    SELECT 1
    FROM private.blog_release_reservations AS r
    WHERE r.merchant_id = NEW.merchant_id
      AND r.post_id = NEW.id
      AND r.state IN ('reserved', 'deferred')
  )
  INTO v_has_active_res;

  IF NOT v_has_active_res THEN
    NEW.published_at := v_now;
    RETURN NEW;
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || NEW.merchant_id::text, 0)
  ) THEN
    NEW.status := 'scheduled';
    NEW.published_at := GREATEST(
      COALESCE(OLD.published_at, v_now),
      v_now + interval '1 minute'
    );
    PERFORM pg_catalog.set_config(
      'baci.allow_reservation_post_sync',
      NEW.id::text,
      true
    );
    RETURN NEW;
  END IF;

  SELECT * INTO v_res
  FROM private.blog_release_reservations AS r
  WHERE r.merchant_id = NEW.merchant_id
    AND r.post_id = NEW.id
    AND r.state IN ('reserved', 'deferred')
  ORDER BY r.updated_at DESC, r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    NEW.published_at := v_now;
    RETURN NEW;
  END IF;

  -- Re-check expired fast-track news before publishing
  IF v_res.release_class = 'fast_track_news'
     AND (
       v_res.event_published_at IS NULL
       OR v_res.event_published_at < v_now - interval '12 hours'
     ) THEN
    NEW.status := 'draft';
    NEW.published_at := NULL;

    UPDATE private.blog_release_reservations
    SET
      state = 'held_expired_news',
      defer_reason = 'fast_track_news_expired_gt_12h',
      next_evaluation_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_res.id;

    RETURN NEW;
  END IF;

  -- Check global spacing against already-published posts (including earlier rows in the same batch)
  IF v_res.min_spacing_minutes > 0 THEN
    SELECT pg_catalog.max(other.published_at)
    INTO v_blocking_published_at
    FROM public.blog_posts AS other
    WHERE other.merchant_id = NEW.merchant_id
      AND other.is_platform_post IS NOT TRUE
      AND other.id <> NEW.id
      AND other.status = 'published'
      AND other.published_at IS NOT NULL
      AND other.published_at > v_now - pg_catalog.make_interval(mins => v_res.min_spacing_minutes)
      AND other.published_at <= v_now + pg_catalog.make_interval(mins => v_res.min_spacing_minutes);

    IF v_blocking_published_at IS NOT NULL THEN
      v_defer_reason := 'min_spacing_active';
      v_next_eval := v_blocking_published_at + pg_catalog.make_interval(mins => v_res.min_spacing_minutes);
      IF v_res.release_class = 'fast_track_news' THEN
        v_next_lagos := v_next_eval AT TIME ZONE 'Africa/Lagos';
        IF v_next_lagos::time < pg_catalog.make_time(v_res.window_start_hour, 0, 0) THEN
          v_next_eval := (
            v_next_lagos::date::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
          ) AT TIME ZONE 'Africa/Lagos';
        ELSIF v_next_lagos::time > pg_catalog.make_time(v_res.window_end_hour, 0, 0) THEN
          v_next_eval := (
            (v_next_lagos::date + 1)::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
          ) AT TIME ZONE 'Africa/Lagos';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Always enforce fast-track Lagos window on every publication attempt
  IF v_defer_reason IS NULL AND v_res.release_class = 'fast_track_news' THEN
    IF v_now_lagos_time < pg_catalog.make_time(v_res.window_start_hour, 0, 0) THEN
      v_defer_reason := 'outside_fast_track_window';
      v_next_eval := (
        v_now_lagos_date::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
      ) AT TIME ZONE 'Africa/Lagos';
    ELSIF v_now_lagos_time > pg_catalog.make_time(v_res.window_end_hour, 0, 0) THEN
      v_defer_reason := 'outside_fast_track_window';
      v_next_eval := (
        (v_now_lagos_date + 1)::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
      ) AT TIME ZONE 'Africa/Lagos';
    END IF;
  END IF;

  -- Always re-check Lagos-day capacity before finalizing publication (handles manual same-day publishes, rollovers, and deferred retries)
  IF v_defer_reason IS NULL THEN
    v_capacity_reason := private.check_blog_release_capacity_reason_v1(
      NEW.merchant_id,
      v_now_lagos_date,
      NEW.id,
      v_res.release_class,
      v_res.is_low_demand_game_software,
      v_res.daily_cap,
      v_res.fast_track_cap,
      v_res.evergreen_min_reserve
    );

    IF v_capacity_reason IS NOT NULL THEN
      v_defer_reason := v_capacity_reason;
      v_next_eval := (
        (v_now_lagos_date + 1)::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
      ) AT TIME ZONE 'Africa/Lagos';
    END IF;
  END IF;

  -- If spacing/window deferral crossed into another Lagos date, validate candidate destination dates
  IF v_defer_reason IS NOT NULL THEN
    v_reserved_lagos_date := v_res.reserved_lagos_date;
    v_next_lagos_date := (v_next_eval AT TIME ZONE 'Africa/Lagos')::date;

    LOOP
      IF v_next_lagos_date IS NOT DISTINCT FROM v_res.reserved_lagos_date THEN
        v_reserved_lagos_date := v_next_lagos_date;
        EXIT;
      END IF;

      v_capacity_reason := private.check_blog_release_capacity_reason_v1(
        NEW.merchant_id,
        v_next_lagos_date,
        NEW.id,
        v_res.release_class,
        v_res.is_low_demand_game_software,
        v_res.daily_cap,
        v_res.fast_track_cap,
        v_res.evergreen_min_reserve
      );

      IF v_capacity_reason IS NULL THEN
        v_reserved_lagos_date := v_next_lagos_date;
        EXIT;
      END IF;

      v_defer_reason := v_capacity_reason;
      EXIT WHEN v_hop >= 30;
      v_hop := v_hop + 1;
      v_next_lagos_date := v_next_lagos_date + 1;
      v_next_eval := (
        v_next_lagos_date::timestamp + pg_catalog.make_time(v_res.window_start_hour, 0, 0)
      ) AT TIME ZONE 'Africa/Lagos';
    END LOOP;

    NEW.status := 'scheduled';
    NEW.published_at := v_next_eval;
    PERFORM pg_catalog.set_config(
      'baci.allow_reservation_post_sync',
      NEW.id::text,
      true
    );

    UPDATE private.blog_release_reservations
    SET
      state = 'deferred',
      reserved_lagos_date = v_reserved_lagos_date,
      defer_reason = v_defer_reason,
      next_evaluation_at = v_next_eval,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_res.id;

    RETURN NEW;
  END IF;

  -- Finalize publication
  NEW.status := 'published';
  NEW.published_at := v_now;

  UPDATE private.blog_release_reservations
  SET
    state = 'published',
    reserved_lagos_date = v_now_lagos_date,
    defer_reason = NULL,
    next_evaluation_at = NULL,
    actual_published_at = v_now,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_res.id;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.finalize_scheduled_blog_post_publication_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_scheduled_blog_post_publication_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS finalize_scheduled_blog_post_publication_v1
  ON public.blog_posts;
CREATE TRIGGER finalize_scheduled_blog_post_publication_v1
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  WHEN (OLD.status = 'scheduled' AND NEW.status = 'published')
  EXECUTE FUNCTION private.finalize_scheduled_blog_post_publication_v1();

CREATE OR REPLACE FUNCTION private.guard_blog_post_identity_and_publication_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.article_identity IS NOT NULL
     AND NEW.article_identity IS DISTINCT FROM OLD.article_identity THEN
    RAISE EXCEPTION 'blog_post_article_identity_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_platform_post IS NOT TRUE
     AND OLD.status = 'published'
     AND NEW.status = 'published' THEN
    NEW.article_identity := COALESCE(OLD.article_identity, NEW.article_identity);
    NEW.published_at := OLD.published_at;
    NEW.requested_publish_at := OLD.requested_publish_at;
  END IF;

  IF NEW.is_platform_post IS NOT TRUE
     AND OLD.status = 'scheduled'
     AND NEW.status = 'scheduled'
     AND (
       NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.requested_publish_at IS DISTINCT FROM OLD.requested_publish_at
     ) THEN
    IF pg_catalog.current_setting('baci.allow_reservation_post_sync', true) = NEW.id::text THEN
      PERFORM pg_catalog.set_config('baci.allow_reservation_post_sync', '', true);
    ELSIF EXISTS (
      SELECT 1
      FROM private.blog_release_reservations AS r
      WHERE r.merchant_id = OLD.merchant_id
        AND r.post_id = OLD.id
        AND r.state IN ('reserved', 'deferred')
    ) THEN
      RAISE EXCEPTION 'scheduled_reservation_requires_reschedule_rpc'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.guard_blog_post_identity_and_publication_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_blog_post_identity_and_publication_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_blog_post_identity_and_publication_v1
  ON public.blog_posts;
CREATE TRIGGER guard_blog_post_identity_and_publication_v1
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_blog_post_identity_and_publication_v1();

-- Preserve original published_at, article_identity, and requested_publish_at on
-- dashboard in-place edits of already-published posts.
CREATE OR REPLACE FUNCTION public.mutate_merchant_blog_post_with_product_links_base(
  p_post_id uuid,
  p_merchant_id uuid,
  p_post_data jsonb,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  merchant_id uuid,
  title text,
  slug text,
  content text,
  excerpt text,
  category text,
  featured_image_url text,
  status text,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_keywords text[];
  v_owned_product_count integer;
  v_post public.blog_posts%ROWTYPE;
  v_tags text[];
BEGIN
  IF p_merchant_id IS NULL OR p_post_data IS NULL THEN
    RAISE EXCEPTION 'merchant_id_and_post_data_required' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(p_post_data) <> 'object' THEN
    RAISE EXCEPTION 'post_data_must_be_an_object' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'merchant_marketing_permission_required' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL AND public.check_staff_permission(auth.uid(), p_merchant_id, 'marketing', 'create') IS NOT TRUE THEN
    RAISE EXCEPTION 'merchant_marketing_create_permission_required' USING ERRCODE = '42501';
  ELSIF p_post_id IS NOT NULL AND public.check_staff_permission(auth.uid(), p_merchant_id, 'marketing', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'merchant_marketing_edit_permission_required' USING ERRCODE = '42501';
  END IF;

  IF p_post_id IS NULL AND (
    NOT (p_post_data ? 'title')
    OR NOT (p_post_data ? 'slug')
    OR NOT (p_post_data ? 'content')
    OR NOT (p_post_data ? 'author_name')
  ) THEN
    RAISE EXCEPTION 'title_slug_content_and_author_name_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_post_data ? 'tags' THEN
    IF pg_catalog.jsonb_typeof(p_post_data -> 'tags') <> 'array' THEN
      RAISE EXCEPTION 'tags_must_be_an_array' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(tag.value)
    INTO v_tags
    FROM pg_catalog.jsonb_array_elements_text(p_post_data -> 'tags') AS tag(value);
  END IF;

  IF p_post_data ? 'keywords' THEN
    IF pg_catalog.jsonb_typeof(p_post_data -> 'keywords') <> 'array' THEN
      RAISE EXCEPTION 'keywords_must_be_an_array' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(keyword.value)
    INTO v_keywords
    FROM pg_catalog.jsonb_array_elements_text(p_post_data -> 'keywords') AS keyword(value);
  END IF;

  IF p_post_id IS NOT NULL THEN
    SELECT * INTO v_post
    FROM public.blog_posts AS blog_post
    WHERE blog_post.id = p_post_id
      AND blog_post.merchant_id = p_merchant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_product_ids IS NOT NULL THEN
    IF pg_catalog.cardinality(p_product_ids) > 20 THEN
      RAISE EXCEPTION 'too_many_embedded_product_ids' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.cardinality(p_product_ids) <> (
      SELECT pg_catalog.count(DISTINCT incoming.product_id)
      FROM pg_catalog.unnest(p_product_ids) AS incoming(product_id)
    ) THEN
      RAISE EXCEPTION 'duplicate_embedded_product_ids' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_owned_product_count
    FROM public.products AS product
    WHERE product.merchant_id = p_merchant_id
      AND product.id = ANY(p_product_ids);

    IF v_owned_product_count <> pg_catalog.cardinality(p_product_ids) THEN
      RAISE EXCEPTION 'embedded_product_not_found_or_not_owned'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_post_id IS NULL THEN
    INSERT INTO public.blog_posts AS blog_post (
      merchant_id,
      title,
      slug,
      content,
      excerpt,
      featured_image_url,
      featured_image_width,
      featured_image_height,
      featured_image_variants,
      featured_image_alt,
      category,
      tags,
      keywords,
      author_name,
      author_title,
      author_image_url,
      author_bio,
      status,
      seo_title,
      seo_description,
      focus_keyword,
      word_count,
      reading_time_minutes,
      published_at
    )
    VALUES (
      p_merchant_id,
      p_post_data ->> 'title',
      p_post_data ->> 'slug',
      p_post_data ->> 'content',
      p_post_data ->> 'excerpt',
      p_post_data ->> 'featured_image_url',
      NULLIF(p_post_data ->> 'featured_image_width', '')::integer,
      NULLIF(p_post_data ->> 'featured_image_height', '')::integer,
      COALESCE(p_post_data -> 'featured_image_variants', '{}'::jsonb),
      p_post_data ->> 'featured_image_alt',
      p_post_data ->> 'category',
      COALESCE(v_tags, '{}'::text[]),
      COALESCE(v_keywords, '{}'::text[]),
      p_post_data ->> 'author_name',
      p_post_data ->> 'author_title',
      p_post_data ->> 'author_image_url',
      p_post_data ->> 'author_bio',
      COALESCE(p_post_data ->> 'status', 'draft'),
      p_post_data ->> 'seo_title',
      p_post_data ->> 'seo_description',
      p_post_data ->> 'focus_keyword',
      NULLIF(p_post_data ->> 'word_count', '')::integer,
      NULLIF(p_post_data ->> 'reading_time_minutes', '')::integer,
      NULLIF(p_post_data ->> 'published_at', '')::timestamptz
    )
    RETURNING * INTO v_post;
  ELSE
    UPDATE public.blog_posts AS blog_post
    SET
      title = CASE
        WHEN p_post_data ? 'title' THEN p_post_data ->> 'title'
        ELSE blog_post.title
      END,
      slug = CASE
        WHEN p_post_data ? 'slug' THEN p_post_data ->> 'slug'
        ELSE blog_post.slug
      END,
      content = CASE
        WHEN p_post_data ? 'content' THEN p_post_data ->> 'content'
        ELSE blog_post.content
      END,
      excerpt = CASE
        WHEN p_post_data ? 'excerpt' THEN p_post_data ->> 'excerpt'
        ELSE blog_post.excerpt
      END,
      featured_image_url = CASE
        WHEN p_post_data ? 'featured_image_url'
          THEN p_post_data ->> 'featured_image_url'
        ELSE blog_post.featured_image_url
      END,
      featured_image_width = CASE
        WHEN p_post_data ? 'featured_image_width'
          THEN NULLIF(p_post_data ->> 'featured_image_width', '')::integer
        ELSE blog_post.featured_image_width
      END,
      featured_image_height = CASE
        WHEN p_post_data ? 'featured_image_height'
          THEN NULLIF(p_post_data ->> 'featured_image_height', '')::integer
        ELSE blog_post.featured_image_height
      END,
      featured_image_variants = CASE
        WHEN p_post_data ? 'featured_image_variants'
          THEN p_post_data -> 'featured_image_variants'
        ELSE blog_post.featured_image_variants
      END,
      featured_image_alt = CASE
        WHEN p_post_data ? 'featured_image_alt'
          THEN p_post_data ->> 'featured_image_alt'
        ELSE blog_post.featured_image_alt
      END,
      category = CASE
        WHEN p_post_data ? 'category' THEN p_post_data ->> 'category'
        ELSE blog_post.category
      END,
      tags = CASE WHEN p_post_data ? 'tags' THEN COALESCE(v_tags, '{}'::text[])
        ELSE blog_post.tags END,
      keywords = CASE
        WHEN p_post_data ? 'keywords' THEN COALESCE(v_keywords, '{}'::text[])
        ELSE blog_post.keywords
      END,
      author_name = CASE
        WHEN p_post_data ? 'author_name' THEN p_post_data ->> 'author_name'
        ELSE blog_post.author_name
      END,
      author_title = CASE
        WHEN p_post_data ? 'author_title' THEN p_post_data ->> 'author_title'
        ELSE blog_post.author_title
      END,
      author_image_url = CASE
        WHEN p_post_data ? 'author_image_url'
          THEN p_post_data ->> 'author_image_url'
        ELSE blog_post.author_image_url
      END,
      author_bio = CASE
        WHEN p_post_data ? 'author_bio' THEN p_post_data ->> 'author_bio'
        ELSE blog_post.author_bio
      END,
      status = CASE
        WHEN p_post_data ? 'status' THEN p_post_data ->> 'status'
        ELSE blog_post.status
      END,
      seo_title = CASE
        WHEN p_post_data ? 'seo_title' THEN p_post_data ->> 'seo_title'
        ELSE blog_post.seo_title
      END,
      seo_description = CASE
        WHEN p_post_data ? 'seo_description'
          THEN p_post_data ->> 'seo_description'
        ELSE blog_post.seo_description
      END,
      focus_keyword = CASE
        WHEN p_post_data ? 'focus_keyword' THEN p_post_data ->> 'focus_keyword'
        ELSE blog_post.focus_keyword
      END,
      word_count = CASE
        WHEN p_post_data ? 'word_count'
          THEN NULLIF(p_post_data ->> 'word_count', '')::integer
        ELSE blog_post.word_count
      END,
      reading_time_minutes = CASE
        WHEN p_post_data ? 'reading_time_minutes'
          THEN NULLIF(p_post_data ->> 'reading_time_minutes', '')::integer
        ELSE blog_post.reading_time_minutes
      END,
      published_at = CASE
        WHEN v_post.status = 'published'
          AND COALESCE(p_post_data ->> 'status', v_post.status) = 'published'
          THEN blog_post.published_at
        WHEN p_post_data ? 'published_at'
          THEN NULLIF(p_post_data ->> 'published_at', '')::timestamptz
        ELSE blog_post.published_at
      END
    WHERE blog_post.id = p_post_id
      AND blog_post.merchant_id = p_merchant_id
    RETURNING * INTO v_post;
  END IF;

  IF p_product_ids IS NOT NULL THEN
    DELETE FROM public.blog_post_products AS link
    WHERE link.blog_post_id = v_post.id
      AND link.merchant_id = p_merchant_id;

    INSERT INTO public.blog_post_products (
      merchant_id,
      blog_post_id,
      product_id,
      relationship,
      position
    )
    SELECT
      p_merchant_id,
      v_post.id,
      incoming.product_id,
      'primary',
      incoming.position::integer
    FROM pg_catalog.unnest(p_product_ids) WITH ORDINALITY
      AS incoming(product_id, position);
  END IF;

  RETURN QUERY
  SELECT
    v_post.id,
    v_post.merchant_id,
    v_post.title,
    v_post.slug,
    v_post.content,
    v_post.excerpt,
    v_post.category,
    v_post.featured_image_url,
    v_post.status,
    v_post.published_at;
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_merchant_blog_post_with_product_links_base(
  uuid, uuid, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;

-- 5. Private implementations + public SECURITY DEFINER trampolines

-- 5a. adopt_merchant_blog_article_identity_v1
CREATE OR REPLACE FUNCTION private.adopt_merchant_blog_article_identity_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_article_identity uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post public.blog_posts%ROWTYPE;
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL OR p_article_identity IS NULL THEN
    RAISE EXCEPTION 'invalid_article_identity_input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

  SELECT * INTO v_post
  FROM public.blog_posts AS p
  WHERE p.id = p_post_id
    AND p.merchant_id = p_merchant_id
    AND p.is_platform_post IS NOT TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'blog_post_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_post.article_identity IS NOT NULL THEN
    IF v_post.article_identity = p_article_identity THEN
      RETURN pg_catalog.jsonb_build_object(
        'post_id', v_post.id,
        'merchant_id', v_post.merchant_id,
        'article_identity', v_post.article_identity,
        'post_status', v_post.status,
        'adopted', false,
        'already_adopted', true
      );
    END IF;
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

  UPDATE public.blog_posts
  SET article_identity = p_article_identity
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
    AND article_identity IS NULL
  RETURNING * INTO v_post;

  RETURN pg_catalog.jsonb_build_object(
    'post_id', v_post.id,
    'merchant_id', v_post.merchant_id,
    'article_identity', v_post.article_identity,
    'post_status', v_post.status,
    'adopted', true,
    'already_adopted', false
  );
END;
$$;

ALTER FUNCTION private.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adopt_merchant_blog_article_identity_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_article_identity uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.adopt_merchant_blog_article_identity_v1(
    p_merchant_id,
    p_post_id,
    p_article_identity
  );
$$;

ALTER FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_merchant_blog_article_identity_v1(uuid, uuid, uuid)
  TO authenticated, service_role;

-- 5b. reserve_merchant_blog_release_v1
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
CREATE OR REPLACE FUNCTION private.cancel_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_reason text DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post public.blog_posts%ROWTYPE;
  v_res private.blog_release_reservations%ROWTYPE;
  v_reason text := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'invalid_cancel_reservation_input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

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
    RAISE EXCEPTION 'cannot_cancel_published_blog_post' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_res
  FROM private.blog_release_reservations AS r
  WHERE r.merchant_id = p_merchant_id
    AND r.post_id = p_post_id
    AND r.state IN ('reserved', 'deferred')
    AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
  ORDER BY r.updated_at DESC, r.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_res
    FROM private.blog_release_reservations AS r
    WHERE r.merchant_id = p_merchant_id
      AND r.post_id = p_post_id
      AND r.state = 'cancelled'
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    ORDER BY r.updated_at DESC, r.created_at DESC
    LIMIT 1;

    IF FOUND AND v_post.status = 'draft' THEN
      RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_res.id,
        'merchant_id', v_res.merchant_id,
        'post_id', v_res.post_id,
        'article_identity', v_post.article_identity,
        'state', v_res.state,
        'post_status', v_post.status,
        'already_cancelled', true
      );
    END IF;

    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE private.blog_release_reservations
  SET
    state = 'cancelled',
    defer_reason = COALESCE(v_reason, defer_reason),
    next_evaluation_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  UPDATE public.blog_posts
  SET
    status = 'draft',
    published_at = NULL,
    requested_publish_at = NULL
  WHERE id = p_post_id
    AND merchant_id = p_merchant_id
  RETURNING * INTO v_post;

  RETURN pg_catalog.jsonb_build_object(
    'reservation_id', v_res.id,
    'merchant_id', v_res.merchant_id,
    'post_id', v_res.post_id,
    'article_identity', v_post.article_identity,
    'state', v_res.state,
    'post_status', v_post.status,
    'already_cancelled', false
  );
END;
$$;

ALTER FUNCTION private.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_merchant_blog_release_v1(
  p_merchant_id uuid,
  p_post_id uuid,
  p_reason text DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.cancel_merchant_blog_release_v1(
    p_merchant_id,
    p_post_id,
    p_reason,
    p_reservation_id
  );
$$;

ALTER FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_merchant_blog_release_v1(uuid, uuid, text, uuid)
  TO authenticated, service_role;

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
CREATE OR REPLACE FUNCTION private.recover_abandoned_blog_release_reservations_v1(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec record;
  v_cancelled_ids uuid[] := '{}'::uuid[];
  v_reconciled_ids uuid[] := '{}'::uuid[];
  v_preserved_count integer := 0;
  v_actual_pub timestamptz;
BEGIN
  PERFORM private.assert_blog_release_actor_v1(p_merchant_id);

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blog-release:' || p_merchant_id::text, 0)
  );

  FOR v_rec IN
    SELECT
      r.id AS reservation_id,
      r.defer_reason,
      p.status AS post_status,
      p.published_at AS post_published_at
    FROM private.blog_release_reservations AS r
    JOIN public.blog_posts AS p
      ON p.id = r.post_id
     AND p.merchant_id = r.merchant_id
    WHERE r.merchant_id = p_merchant_id
      AND r.state IN ('reserved', 'deferred')
    ORDER BY r.created_at ASC, r.id ASC
    FOR UPDATE OF r, p
  LOOP
    IF v_rec.post_status IN ('draft', 'archived') THEN
      UPDATE private.blog_release_reservations
      SET
        state = 'cancelled',
        defer_reason = COALESCE(defer_reason, 'recovered_abandoned_non_scheduled_post'),
        next_evaluation_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_rec.reservation_id;

      v_cancelled_ids := pg_catalog.array_append(v_cancelled_ids, v_rec.reservation_id);
    ELSIF v_rec.post_status = 'published' THEN
      v_actual_pub := COALESCE(v_rec.post_published_at, pg_catalog.clock_timestamp());

      UPDATE private.blog_release_reservations
      SET
        state = 'published',
        reserved_lagos_date = (v_actual_pub AT TIME ZONE 'Africa/Lagos')::date,
        defer_reason = NULL,
        next_evaluation_at = NULL,
        actual_published_at = COALESCE(actual_published_at, v_actual_pub),
        updated_at = pg_catalog.clock_timestamp()
      WHERE id = v_rec.reservation_id;

      v_reconciled_ids := pg_catalog.array_append(v_reconciled_ids, v_rec.reservation_id);
    ELSE
      -- Still scheduled: never release a still-scheduled article's capacity
      v_preserved_count := v_preserved_count + 1;
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'merchant_id', p_merchant_id,
    'cancelled_abandoned_count', pg_catalog.cardinality(v_cancelled_ids),
    'reconciled_published_count', pg_catalog.cardinality(v_reconciled_ids),
    'preserved_scheduled_count', v_preserved_count,
    'cancelled_reservation_ids', v_cancelled_ids,
    'reconciled_reservation_ids', v_reconciled_ids
  );
END;
$$;

ALTER FUNCTION private.recover_abandoned_blog_release_reservations_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.recover_abandoned_blog_release_reservations_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recover_abandoned_blog_release_reservations_v1(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.recover_abandoned_blog_release_reservations_v1(p_merchant_id);
$$;

ALTER FUNCTION public.recover_abandoned_blog_release_reservations_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recover_abandoned_blog_release_reservations_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_abandoned_blog_release_reservations_v1(uuid)
  TO authenticated, service_role;

COMMIT;
