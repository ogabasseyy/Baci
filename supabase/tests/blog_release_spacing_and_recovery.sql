BEGIN;
\ir blog_release_reservations_setup.inc.sql

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- 5. Cross-UTC-midnight spacing check (23:50Z and 00:10Z next UTC day = 20m apart -> blocked; 00:20Z -> allowed)
DO $$
DECLARE
  v_utc_base timestamptz := (date_trunc('day', transaction_timestamp() AT TIME ZONE 'UTC') + interval '20 days 23 hours 50 minutes') AT TIME ZONE 'UTC';
  v_too_close timestamptz := v_utc_base + interval '20 minutes';
  v_ok_next timestamptz := v_utc_base + interval '30 minutes';
  v_r jsonb;
BEGIN
  v_r := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000006',
    'e1000000-0000-4000-8000-000000000006',
    'req-utc-midnight-1',
    repeat('2', 64),
    'policy-2026-11',
    'evergreen',
    v_utc_base,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r ->> 'state' = 'reserved', '23:50Z slot reserved');

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000007',
        'e1000000-0000-4000-8000-000000000007',
        'req-utc-midnight-2-close',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('3', 64),
      v_too_close::text
    ),
    'P0001',
    'min_spacing_conflict',
    'cross-UTC-midnight slot 20m later must fail global spacing check'
  );

  v_r := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000007',
    'e1000000-0000-4000-8000-000000000007',
    'req-utc-midnight-2-ok',
    repeat('3', 64),
    'policy-2026-11',
    'evergreen',
    v_ok_next,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r ->> 'state' = 'reserved', '30m after 23:50Z succeeds');
END $$;

-- 6. Abandoned reservation recovery: draft cancelled, published reconciled, scheduled preserved
DO $$
DECLARE
  v_rec jsonb;
BEGIN
  -- Simulate post 6 abandoned directly back to draft while reservation still active
  UPDATE public.blog_posts
  SET status = 'draft', published_at = NULL
  WHERE id = 'd3000000-0000-4000-8000-000000000006';

  -- Simulate an out-of-band reservation stuck in 'reserved' for an already-published post (post 1),
  -- post 7 being published through the trigger, and post 2 remaining scheduled
  PERFORM public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-recover-scheduled-post2',
    repeat('6', 64),
    'policy-2026-11',
    'standard',
    (((transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 18)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos',
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  UPDATE public.blog_posts
  SET status = 'published', published_at = '2026-11-01T10:00:00Z'
  WHERE id = 'd3000000-0000-4000-8000-000000000007';

  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'req-orphan-published-post1',
    repeat('9', 64),
    'policy-2026-11',
    'evergreen',
    '2026-10-01T10:00:00Z',
    '2026-10-01'::date,
    3, 2, 1, 30, 'reserved'
  );

  v_rec := public.recover_abandoned_blog_release_reservations_v1(
    'd2000000-0000-4000-8000-000000000001'
  );
  PERFORM pg_temp.assert_true((v_rec ->> 'cancelled_abandoned_count')::integer = 1, 'recover cancels abandoned draft reservation');
  PERFORM pg_temp.assert_true((v_rec ->> 'reconciled_published_count')::integer = 1, 'recover reconciles published reservation');
  PERFORM pg_temp.assert_true((v_rec ->> 'preserved_scheduled_count')::integer = 1, 'recover preserves still-scheduled reservations');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'cancelled' FROM private.blog_release_reservations WHERE post_id = 'd3000000-0000-4000-8000-000000000006' ORDER BY created_at DESC LIMIT 1),
    'abandoned reservation moved to cancelled'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND actual_published_at IS NOT NULL FROM private.blog_release_reservations WHERE request_id = 'req-orphan-published-post1'),
    'orphan published reservation reconciled to published'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND actual_published_at IS NOT NULL FROM private.blog_release_reservations WHERE post_id = 'd3000000-0000-4000-8000-000000000007' ORDER BY created_at DESC LIMIT 1),
    'trigger-finalized reservation marked published'
  );
END $$;

DO $$
DECLARE
  v_slot_orig timestamptz := (
    ((transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 26)::timestamp + time '10:00:00'
  ) AT TIME ZONE 'Africa/Lagos';
  v_slot_new timestamptz := (
    ((transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 27)::timestamp + time '10:00:00'
  ) AT TIME ZONE 'Africa/Lagos';
  v_post_id uuid := 'd3000000-0000-4000-8000-000000000005';
  v_res jsonb;
  v_err text;
  v_reserved_at timestamptz;
BEGIN
  v_res := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    v_post_id,
    'e1000000-0000-4000-8000-000000000001',
    'req-atomic-rollback',
    repeat('b', 64),
    'policy-2026-11',
    'evergreen',
    v_slot_orig
  );
  PERFORM pg_temp.assert_true((v_res ->> 'state') = 'reserved', 'atomic rollback setup reserved');

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

  BEGIN
    PERFORM * FROM public.reschedule_and_mutate_merchant_blog_post_v1(
      v_post_id,
      'd2000000-0000-4000-8000-000000000001',
      v_slot_new,
      jsonb_build_object('title', 'Should Roll Back'),
      ARRAY['ffffffff-ffff-4fff-8fff-ffffffffffff']::uuid[]
    );
    RAISE EXCEPTION 'expected atomic rollback failure';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;

  PERFORM pg_temp.assert_true(
    v_err LIKE '%embedded_product_not_found_or_not_owned%',
    'atomic reschedule-and-mutate propagates mutation failure'
  );
  SELECT requested_publish_at INTO v_reserved_at
  FROM private.blog_release_reservations
  WHERE post_id = v_post_id AND state = 'reserved';
  PERFORM pg_temp.assert_true(
    v_reserved_at = v_slot_orig,
    'failed mutation rolls back reschedule_merchant_blog_release_v1'
  );
END $$;

ROLLBACK;
