BEGIN;
\ir blog_release_reservations_setup.inc.sql

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

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
  -- Setup slot 1 on v_future_date for 4h-4o checks
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

  -- 4h. Boundary 08:00:00 Lagos succeeds for fast_track_news (slot 2 of 3)
  v_r2 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000003',
    'req-post-3-ft-ok',
    repeat('d', 64),
    'policy-2026-11',
    'fast_track_news',
    v_slot_edge_start,
    'breaking_news',
    'Tech',
    false,
    transaction_timestamp() - interval '2 hours',
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r2 ->> 'state' = 'reserved', '08:00 Lagos fast_track_news succeeds');

  -- 4i. Slot 3 of 3 with daily_cap=3, evergreen_min_reserve=1 blocks standard/fast_track_news
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000004',
        'e1000000-0000-4000-8000-000000000004',
        'req-post-4-reserve-block',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz,
        3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('e', 64),
      v_slot_edge_end::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    'P0001',
    'evergreen_reserve_required',
    'last slot must be preserved for evergreen when evergreen_used=0 and evergreen_min_reserve=1'
  );

  -- 4j. Evergreen post CAN take slot 3 of 3
  v_r3 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000004',
    'req-post-4-evergreen',
    repeat('e', 64),
    'policy-2026-11',
    'evergreen',
    v_slot_3,
    'evergreen_guide',
    'Guides',
    false,
    NULL,
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r3 ->> 'state' = 'reserved', 'evergreen claims the reserved 3rd slot');

  -- 4k. Slot 4 blocked by daily_cap_exceeded
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000005',
        'e1000000-0000-4000-8000-000000000005',
        'req-post-5-cap',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('f', 64),
      v_slot_2::text
    ),
    'P0001',
    'daily_cap_exceeded',
    '4th post exceeds daily_cap=3'
  );

  -- 4l. Reschedule post 4 in-place on the same full day does NOT double count itself
  v_r3 := public.reschedule_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    v_slot_2,
    'req-post-4-reschedule'
  );
  PERFORM pg_temp.assert_true((v_r3 ->> 'rescheduled')::boolean, 'reschedule updates slot without double counting target post');
  PERFORM pg_temp.assert_true(
    (SELECT published_at = v_slot_2 AND requested_publish_at = v_slot_2
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000004'),
    'blog_posts timestamps updated on reschedule'
  );

  -- Idempotent reschedule replay on unchanged slot
  v_r3 := public.reschedule_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    v_slot_2,
    'req-post-4-reschedule'
  );
  PERFORM pg_temp.assert_true((v_r3 ->> 'idempotent_replay')::boolean, 'unchanged reschedule returns idempotent_replay');

  -- 4m. Cancel frees the slot and reverts post to draft; repeat cancel is idempotent
  v_r1 := public.cancel_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    'operator_cancelled'
  );
  PERFORM pg_temp.assert_true(v_r1 ->> 'state' = 'cancelled' AND v_r1 ->> 'post_status' = 'draft', 'cancel reverts post to draft');
  PERFORM pg_temp.assert_true(
    (SELECT article_identity = 'e1000000-0000-4000-8000-000000000004'::uuid AND published_at IS NULL AND requested_publish_at IS NULL
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000004'),
    'cancel preserves article_identity and clears publish timestamps'
  );
  v_r1_replay := public.cancel_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004'
  );
  PERFORM pg_temp.assert_true((v_r1_replay ->> 'already_cancelled')::boolean, 'repeat cancel returns already_cancelled');

  -- 4n. Now post 5 can claim the freed slot
  v_r3 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000005',
    'e1000000-0000-4000-8000-000000000005',
    'req-post-5-after-cancel',
    repeat('f', 64),
    'policy-2026-11',
    'evergreen',
    v_slot_3,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r3 ->> 'state' = 'reserved', 'freed slot after cancel can be reserved');

  -- 4o. Archived post rejection & published post rejection
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000008',
        'e1000000-0000-4000-8000-000000000008',
        'req-archived',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('1', 64),
      (((v_future_date + 1)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos')::text
    ),
    '22023',
    'blog_post_archived',
    'cannot reserve archived post'
  );

  PERFORM pg_temp.assert_error(
    $sql$SELECT public.cancel_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001'
    )$sql$,
    '40001',
    'cannot_cancel_published_blog_post',
    'cannot cancel already published post'
  );
END $$;

ROLLBACK;
