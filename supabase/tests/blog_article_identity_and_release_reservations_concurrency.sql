-- Multi-session advisory-lock concurrency & retry tests using dblink.
-- Runs cleanly against both standalone disposable fixture and full replay.

\set ON_ERROR_STOP on
\if :{?dblink_password}
\else
\set dblink_password postgres
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN
    CREATE EXTENSION dblink;
    PERFORM set_config('baci.drop_dblink_after_test', 'true', false);
  ELSE
    PERFORM set_config('baci.drop_dblink_after_test', 'false', false);
  END IF;
END $$;

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DELETE FROM public.merchants
WHERE id = 'd2000000-0000-4000-8000-000000000004';

INSERT INTO public.merchants (id, email, user_id, business_name, slug)
VALUES (
  'd2000000-0000-4000-8000-000000000004',
  'track1-conc@example.invalid',
  NULL,
  'Track1 Concurrency Merchant',
  'track1-conc-merchant'
);

INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status
) VALUES
  ('d3000000-0000-4000-8000-000000000201', 'd2000000-0000-4000-8000-000000000004', 'Conc Post A', 'conc-post-a', 'Content A', 'Editor', 'draft'),
  ('d3000000-0000-4000-8000-000000000202', 'd2000000-0000-4000-8000-000000000004', 'Conc Post B', 'conc-post-b', 'Content B', 'Editor', 'draft'),
  ('d3000000-0000-4000-8000-000000000203', 'd2000000-0000-4000-8000-000000000004', 'Conc Post C', 'conc-post-c', 'Content C', 'Editor', 'draft');
COMMIT;

SELECT pg_catalog.set_config(
  'baci.conc_connstr',
  CASE
    WHEN pg_catalog.inet_server_addr() IS NULL THEN pg_catalog.format(
      'dbname=%s user=%s',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_database(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_user(), E'\\', E'\\\\'), '''', E'\\''') || ''''
    )
    ELSE pg_catalog.format(
      'host=%s port=%s dbname=%s user=%s password=%s',
      pg_catalog.inet_server_addr(),
      pg_catalog.inet_server_port(),
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_database(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(pg_catalog.current_user(), E'\\', E'\\\\'), '''', E'\\''') || '''',
      '''' || pg_catalog.replace(pg_catalog.replace(:'dblink_password', E'\\', E'\\\\'), '''', E'\\''') || ''''
    )
  END,
  false
) IS NOT NULL AS connstr_configured;

DO $$
DECLARE
  v_connstr text := current_setting('baci.conc_connstr');
  v_slot_day1 timestamptz := (
    ((transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 30)::timestamp + time '10:00:00'
  ) AT TIME ZONE 'Africa/Lagos';
  v_slot_day2 timestamptz := (
    ((transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 31)::timestamp + time '10:00:00'
  ) AT TIME ZONE 'Africa/Lagos';
  v_res_a jsonb;
  v_res_c1 jsonb;
  v_res_c2 jsonb;
  v_wait_ok boolean := false;
  v_i integer;
  v_err text;
  v_res_count integer;
BEGIN
  PERFORM dblink_connect('conn_a', v_connstr);
  PERFORM dblink_connect('conn_b', v_connstr);

  -- Case 1: Two sessions racing the last daily_cap=1 slot on day1
  PERFORM dblink_exec('conn_a', 'BEGIN');
  PERFORM dblink_exec('conn_a', $q$SET LOCAL request.jwt.claim.role = 'service_role'$q$);
  SELECT res INTO v_res_a
  FROM dblink(
    'conn_a',
    format(
      $q$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000004',
        'd3000000-0000-4000-8000-000000000201',
        'e1000000-0000-4000-8000-000000000201',
        'req-conc-a',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL,
        1, 2, 1, 30, 8, 20
      )$q$,
      repeat('a', 64),
      v_slot_day1::text
    )
  ) AS t(res jsonb);

  IF (v_res_a ->> 'state') IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'Expected conn_a to reserve day1 slot, got %', v_res_a;
  END IF;

  PERFORM dblink_send_query(
    'conn_b',
    format(
      $q$SELECT
        set_config('request.jwt.claim.role', 'service_role', true),
        public.reserve_merchant_blog_release_v1(
          'd2000000-0000-4000-8000-000000000004',
          'd3000000-0000-4000-8000-000000000202',
          'e1000000-0000-4000-8000-000000000202',
          'req-conc-b',
          %L,
          'policy-2026-11',
          'evergreen',
          %L::timestamptz,
          NULL, NULL, false, NULL,
          1, 2, 1, 30, 8, 20
        )$q$,
      repeat('b', 64),
      (v_slot_day1 + interval '1 hour')::text
    )
  );

  v_wait_ok := false;
  FOR v_i IN 1..30 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
        AND query LIKE '%req-conc-b%'
    ) THEN
      v_wait_ok := true;
      EXIT;
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT v_wait_ok THEN
    RAISE EXCEPTION 'conn_b did not block on per-merchant advisory lock as expected';
  END IF;

  PERFORM dblink_exec('conn_a', 'COMMIT');

  DECLARE
    v_conn_b_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM *
      FROM dblink_get_result('conn_b') AS t(role_cfg text, res jsonb);
    EXCEPTION
      WHEN OTHERS THEN
        v_conn_b_failed := true;
        v_err := SQLERRM;
        IF position('daily_cap_exceeded' IN v_err) = 0 THEN
          RAISE EXCEPTION 'Expected daily_cap_exceeded on conn_b, got: %', v_err;
        END IF;
    END;

    IF NOT v_conn_b_failed THEN
      RAISE EXCEPTION 'conn_b succeeded unexpectedly instead of failing with daily_cap_exceeded';
    END IF;
  END;
  -- Drain any remaining async result state on conn_b
  PERFORM * FROM dblink_get_result('conn_b', false) AS t(msg text);

  SELECT count(*) INTO v_res_count
  FROM private.blog_release_reservations
  WHERE merchant_id = 'd2000000-0000-4000-8000-000000000004'
    AND state = 'reserved';
  IF v_res_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 reserved row on day1 race, got %', v_res_count;
  END IF;

  -- Case 2: Two sessions racing identical (merchant_id, request_id, payload_digest) on day2
  PERFORM dblink_exec('conn_a', 'BEGIN');
  PERFORM dblink_exec('conn_a', $q$SET LOCAL request.jwt.claim.role = 'service_role'$q$);
  SELECT res INTO v_res_c1
  FROM dblink(
    'conn_a',
    format(
      $q$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000004',
        'd3000000-0000-4000-8000-000000000203',
        'e1000000-0000-4000-8000-000000000203',
        'req-conc-idem',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL,
        2, 2, 1, 30, 8, 20
      )$q$,
      repeat('c', 64),
      v_slot_day2::text
    )
  ) AS t(res jsonb);

  PERFORM dblink_send_query(
    'conn_b',
    format(
      $q$SELECT
        set_config('request.jwt.claim.role', 'service_role', true),
        public.reserve_merchant_blog_release_v1(
          'd2000000-0000-4000-8000-000000000004',
          'd3000000-0000-4000-8000-000000000203',
          'e1000000-0000-4000-8000-000000000203',
          'req-conc-idem',
          %L,
          'policy-2026-11',
          'evergreen',
          %L::timestamptz,
          NULL, NULL, false, NULL,
          2, 2, 1, 30, 8, 20
        )$q$,
      repeat('c', 64),
      v_slot_day2::text
    )
  );

  v_wait_ok := false;
  FOR v_i IN 1..30 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
        AND query LIKE '%req-conc-idem%'
    ) THEN
      v_wait_ok := true;
      EXIT;
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT v_wait_ok THEN
    RAISE EXCEPTION 'conn_b did not block on advisory lock for idempotent retry';
  END IF;

  PERFORM dblink_exec('conn_a', 'COMMIT');

  SELECT res INTO v_res_c2
  FROM dblink_get_result('conn_b') AS t(role_cfg text, res jsonb);
  PERFORM * FROM dblink_get_result('conn_b', false) AS t(msg text);

  IF ((v_res_c2 ->> 'idempotent_replay')::boolean) IS NOT TRUE THEN
    RAISE EXCEPTION 'Expected concurrent duplicate request_id to return idempotent_replay=true, got %', v_res_c2;
  END IF;
  IF (v_res_c2 ->> 'reservation_id') IS DISTINCT FROM (v_res_c1 ->> 'reservation_id') THEN
    RAISE EXCEPTION 'Expected same reservation_id on idempotent replay';
  END IF;

  -- Case 3: Advisory lock contention during publication UPDATE defers a due post non-blockingly without deadlock
  PERFORM *
  FROM dblink(
    'conn_b',
    $q$SELECT
      set_config('request.jwt.claim.role', 'service_role', true),
      public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000004',
        'd3000000-0000-4000-8000-000000000201',
        pg_catalog.transaction_timestamp() - interval '1 minute',
        'req-conc-due-for-case3'
      )$q$
  ) AS t(role_cfg text, res jsonb);

  PERFORM dblink_exec('conn_a', 'BEGIN');
  PERFORM *
  FROM dblink(
    'conn_a',
    $q$SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('blog-release:d2000000-0000-4000-8000-000000000004', 0)) IS NOT NULL$q$
  ) AS t(locked boolean);

  DECLARE
    v_pub_status text;
    v_pub_at timestamptz;
    v_res_state text;
  BEGIN
    PERFORM dblink_exec('conn_b', 'SET statement_timeout = 3000');
    SELECT status, published_at
    INTO v_pub_status, v_pub_at
    FROM dblink(
      'conn_b',
      $q$UPDATE public.blog_posts
         SET status = 'published'
         WHERE id = 'd3000000-0000-4000-8000-000000000201'
         RETURNING status, published_at$q$
    ) AS t(status text, published_at timestamptz);
    PERFORM dblink_exec('conn_b', 'SET statement_timeout = 0');

    SELECT state INTO v_res_state
    FROM private.blog_release_reservations
    WHERE post_id = 'd3000000-0000-4000-8000-000000000201'
      AND state IN ('reserved', 'deferred')
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_pub_status IS DISTINCT FROM 'scheduled'
       OR v_pub_at IS NULL
       OR v_pub_at < transaction_timestamp() + interval '50 seconds'
       OR v_pub_at > clock_timestamp() + interval '2 minutes'
       OR v_res_state IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'Expected bounded non-blocking contention deferral on conn_b, got status=%, published_at=%, res_state=%',
        v_pub_status, v_pub_at, v_res_state;
    END IF;
  END;

  PERFORM dblink_exec('conn_a', 'COMMIT');

  PERFORM dblink_disconnect('conn_a');
  PERFORM dblink_disconnect('conn_b');
END $$;

-- Clean up committed test rows cleanly
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
DELETE FROM public.merchants
WHERE id = 'd2000000-0000-4000-8000-000000000004';
COMMIT;

DO $$
BEGIN
  IF current_setting('baci.drop_dblink_after_test', true) = 'true' THEN
    DROP EXTENSION IF EXISTS dblink;
  END IF;
END $$;
