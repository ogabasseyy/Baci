BEGIN;

-- 4. Triggers on public.blog_posts
-- Runs BEFORE guard_blog_post_identity_and_publication_v1 (alphabetically 'f' < 'g')
-- Note: Manual draft -> published dashboard edits intentionally bypass this
-- trigger; scheduled/reserved posts enforce caps, spacing, and 12h expiry here.
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

COMMIT;
