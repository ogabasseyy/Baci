BEGIN;

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
