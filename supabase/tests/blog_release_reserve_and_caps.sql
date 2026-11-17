BEGIN;
\ir blog_release_reservations_setup.inc.sql

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- 4. Reserve: idempotency, digest mismatch, caps, evergreen reserve, fast-track news rules, game-software cap, global spacing
DO $$
DECLARE
  v_future_date date := (transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 10;
  v_slot_1 timestamptz := (v_future_date::timestamp + time '09:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_2 timestamptz := (v_future_date::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_3 timestamptz := (v_future_date::timestamp + time '11:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_close timestamptz := (v_future_date::timestamp + time '09:20:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_edge_start timestamptz := (v_future_date::timestamp + time '08:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_edge_end timestamptz := (v_future_date::timestamp + time '20:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_early timestamptz := (v_future_date::timestamp + time '07:59:59') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_late timestamptz := (v_future_date::timestamp + time '20:00:01') AT TIME ZONE 'Africa/Lagos';
  v_r1 jsonb;
  v_r1_replay jsonb;
  v_r2 jsonb;
  v_r3 jsonb;
BEGIN
  -- 4a. Reserve Draft Post 2 as standard (first slot)
  v_r1 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-post-2-v1',
    repeat('b', 64),
    'policy-2026-11',
    'standard',
    v_slot_1,
    'standard_editorial',
    'Smartphones',
    true, -- low-demand game software #1
    NULL,
    3,
    2,
    1,
    30,
    8,
    20
  );
  PERFORM pg_temp.assert_true(v_r1 ->> 'state' = 'reserved', 'post 2 should be reserved');
  PERFORM pg_temp.assert_true(v_r1 ->> 'post_status' = 'scheduled', 'post 2 should become scheduled');
  PERFORM pg_temp.assert_true(NOT (v_r1 ->> 'idempotent_replay')::boolean, 'initial call is not replay');
  PERFORM pg_temp.assert_true(
    (SELECT status = 'scheduled' AND published_at = v_slot_1 AND requested_publish_at = v_slot_1
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000002'),
    'blog_posts row updated atomically on reserve'
  );

  -- 4b. Idempotent replay with identical request_id + digest
  v_r1_replay := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-post-2-v1',
    repeat('b', 64),
    'policy-2026-11',
    'standard',
    v_slot_1,
    'standard_editorial',
    'Smartphones',
    true,
    NULL,
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true((v_r1_replay ->> 'idempotent_replay')::boolean, 'identical request_id + digest replays idempotently');
  PERFORM pg_temp.assert_true(v_r1_replay ->> 'reservation_id' = v_r1 ->> 'reservation_id', 'replay returns same reservation_id');

  -- 4c. Same request_id with mismatched digest -> 40001
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000002',
        'req-post-2-v1',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('c', 64),
      v_slot_1::text
    ),
    '40001',
    'reservation_request_payload_mismatch',
    'same request_id with different payload_digest must raise mismatch'
  );

  -- 4d. Different request_id on already-reserved post -> active_reservation_already_exists
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000002',
        'req-post-2-v2',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('c', 64),
      v_slot_2::text
    ),
    '40001',
    'active_reservation_already_exists',
    'cannot create second active reservation for same post'
  );

  -- 4e. Global min spacing conflict (20m apart < 30m)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-spacing',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_close::text
    ),
    'P0001',
    'min_spacing_conflict',
    'slot within 30m of post 2 must fail spacing check'
  );

  -- 4f. Standalone low-demand game software cap (<= 1/day)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-game-cap',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz,
        NULL,
        'Gaming',
        true
      )$sql$,
      repeat('d', 64),
      v_slot_2::text
    ),
    'P0001',
    'low_demand_game_software_cap_exceeded',
    'second low-demand game software item on same Lagos day must fail'
  );

  -- 4g. Fast-track validation rules (future event, >12h old, outside 08:00-20:00 Lagos, fast_track_cap > 2)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-cap3',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz,
        3,
        3,
        1
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'invalid_fast_track_cap',
    'fast_track_cap > 2 must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-future',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() + interval '5 minutes')::text
    ),
    '22023',
    'fast_track_event_in_future',
    'future event_published_at must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-stale',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() - interval '12 hours 1 minute')::text
    ),
    '22023',
    'fast_track_news_expired',
    'event older than 12 hours must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-early',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_early::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'fast_track_outside_lagos_window',
    '07:59:59 Lagos must be rejected for fast_track_news'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-late',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_late::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'fast_track_outside_lagos_window',
    '20:00:01 Lagos must be rejected for fast_track_news'
  );

END $$;

ROLLBACK;
