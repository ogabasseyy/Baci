BEGIN;
\ir blog_release_reservations_setup.inc.sql

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today_lagos date := (v_now AT TIME ZONE 'Africa/Lagos')::date;
  v_yesterday_lagos date := ((v_now AT TIME ZONE 'Africa/Lagos')::date - 1);
  v_slot_init timestamptz := (((v_now AT TIME ZONE 'Africa/Lagos')::date + 20)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
BEGIN
  INSERT INTO public.merchants (id, email, user_id, business_name, slug)
  VALUES ('d2000000-0000-4000-8000-000000000003', 'track1-c@example.invalid', NULL, 'Merchant C', 'merchant-c');
  INSERT INTO public.blog_posts (id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity)
  VALUES ('d3000000-0000-4000-8000-000000000014', 'd2000000-0000-4000-8000-000000000003', 'Rollover Over Cap', 'rollover-over-cap', 'Rollover cap content', 'Editor C', 'scheduled', v_slot_init, v_slot_init, 'e1000000-0000-4000-8000-000000000014');
  INSERT INTO private.blog_release_reservations (merchant_id, post_id, article_identity, request_id, payload_digest, policy_version, release_class, requested_publish_at, reserved_lagos_date, daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state)
  VALUES ('d2000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000014', 'e1000000-0000-4000-8000-000000000014', 'req-rollover-cap-seed', repeat('9', 64), 'policy-2026-11', 'evergreen', v_slot_init, (v_slot_init AT TIME ZONE 'Africa/Lagos')::date, 1, 2, 1, 30, 'reserved');

  -- 8. Regression checks for CodeRabbit findings (#14, #15, #17, #19, #20)
  -- 8a. Direct schedule edit on a reserved scheduled post is rejected; title edit without timestamp change succeeds
  PERFORM pg_temp.assert_error(
    format(
      $sql$UPDATE public.blog_posts SET published_at = %L::timestamptz WHERE id = 'd3000000-0000-4000-8000-000000000014'$sql$,
      (v_now + interval '4 hours')::text
    ),
    '42501',
    'scheduled_reservation_requires_reschedule_rpc',
    'direct schedule edit on reserved post must fail closed'
  );
  UPDATE public.blog_posts
  SET title = 'Rollover Over Cap Title Edit'
  WHERE id = 'd3000000-0000-4000-8000-000000000014';

  -- 8b. Reschedule with same timestamp but different p_min_spacing_minutes applies policy change (not idempotent replay)
  --     and preserving original reserve request_id blocks post-cancel replay of original request_id
  DECLARE
    v_res_orig jsonb;
    v_res_policy jsonb;
    v_res_replay jsonb;
    v_slot_8b timestamptz := ((v_today_lagos + 25)::timestamp + time '11:00:00') AT TIME ZONE 'Africa/Lagos';
    v_ft_row public.blog_posts%ROWTYPE;
    v_now_lagos_hr integer := EXTRACT(HOUR FROM (v_now AT TIME ZONE 'Africa/Lagos'))::integer;
    v_bad_win_start integer := CASE WHEN v_now_lagos_hr < 20 THEN 21 ELSE 8 END;
    v_bad_win_end integer := CASE WHEN v_now_lagos_hr < 20 THEN 22 ELSE 9 END;
  BEGIN
    INSERT INTO public.blog_posts (
      id, merchant_id, title, slug, content, author_name, status
    ) VALUES (
      'd3000000-0000-4000-8000-000000000015',
      'd2000000-0000-4000-8000-000000000003',
      'Policy Replay Test', 'policy-replay-test', 'Body', 'Editor C', 'draft'
    );

    v_res_orig := public.reserve_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'e1000000-0000-4000-8000-000000000015',
      'req-8b-orig',
      repeat('a', 64),
      'policy-2026-11',
      'evergreen',
      v_slot_8b,
      NULL, NULL, false, NULL,
      3, 2, 1, 30, 8, 20
    );
    v_res_policy := public.reschedule_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      v_slot_8b,
      'req-8b-resched',
      NULL, NULL, NULL, 45, NULL, NULL
    );
    PERFORM pg_temp.assert_true(
      NOT (v_res_policy ->> 'idempotent_replay')::boolean AND (v_res_policy ->> 'rescheduled')::boolean,
      'reschedule with changed min_spacing_minutes must update policy instead of replaying'
    );
    PERFORM pg_temp.assert_true(
      (SELECT min_spacing_minutes = 45 AND request_id = 'req-8b-orig'
       FROM private.blog_release_reservations WHERE id = (v_res_orig ->> 'reservation_id')::uuid),
      'reschedule must apply min_spacing_minutes=45 and preserve original request_id'
    );

    PERFORM public.cancel_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'cancel_after_resched'
    );
    v_res_replay := public.reserve_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'e1000000-0000-4000-8000-000000000015',
      'req-8b-orig',
      repeat('a', 64),
      'policy-2026-11',
      'evergreen',
      v_slot_8b
    );
    PERFORM pg_temp.assert_true(
      (v_res_replay ->> 'idempotent_replay')::boolean AND v_res_replay ->> 'state' = 'cancelled' AND v_res_replay ->> 'post_status' = 'draft',
      'retrying original reserve request after reschedule+cancel must replay cancelled reservation without re-scheduling'
    );

    -- 8c. Same-day fast_track_news outside active Lagos window defers even when reserved_lagos_date = v_today_lagos
    INSERT INTO public.blog_posts (
      id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
    ) VALUES (
      'd3000000-0000-4000-8000-000000000016',
      'd2000000-0000-4000-8000-000000000003',
      'Same Day Window Check', 'same-day-window-check', 'News', 'Editor C', 'scheduled',
      v_now - interval '1 minute',
      v_now - interval '1 minute',
      'e1000000-0000-4000-8000-000000000016'
    );
    INSERT INTO private.blog_release_reservations (
      merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
      release_class, requested_publish_at, reserved_lagos_date, event_published_at,
      daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes,
      window_start_hour, window_end_hour, state
    ) VALUES (
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000016',
      'e1000000-0000-4000-8000-000000000016',
      'req-8c-same-day-window',
      repeat('9', 64),
      'policy-2026-11',
      'fast_track_news',
      v_now - interval '1 minute',
      v_today_lagos,
      v_now - interval '1 hour',
      5, 2, 0, 0,
      v_bad_win_start, v_bad_win_end, 'reserved'
    );
    UPDATE public.blog_posts
    SET status = 'published'
    WHERE id = 'd3000000-0000-4000-8000-000000000016'
    RETURNING * INTO v_ft_row;
    PERFORM pg_temp.assert_true(
      v_ft_row.status = 'scheduled',
      'same-day fast_track_news outside active window must defer'
    );
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'outside_fast_track_window'
       FROM private.blog_release_reservations WHERE request_id = 'req-8c-same-day-window'),
      'same-day fast_track_news deferral records outside_fast_track_window'
    );

    -- 8d. Reschedule retry across different session TimeZones does not raise payload mismatch,
    --     and multi-day rollover checks candidate destination dates before assigning reserved_lagos_date
    DECLARE
      v_tz_slot timestamptz := ((v_today_lagos + 26)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
      v_tz_res1 jsonb;
      v_tz_res2 jsonb;
      v_multi_row public.blog_posts%ROWTYPE;
    BEGIN
      INSERT INTO public.blog_posts (
        id, merchant_id, title, slug, content, author_name, status
      ) VALUES (
        'd3000000-0000-4000-8000-000000000017',
        'd2000000-0000-4000-8000-000000000003',
        'TZ Reschedule Post', 'tz-reschedule-post', 'TZ content', 'Editor C', 'draft'
      );
      PERFORM public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        'e1000000-0000-4000-8000-000000000017',
        'req-8d-reserve',
        repeat('b', 64),
        'policy-2026-11',
        'evergreen',
        v_tz_slot
      );
      PERFORM set_config('TimeZone', 'UTC', true);
      v_tz_res1 := public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        v_tz_slot + interval '2 hours',
        'req-8d-resched'
      );
      PERFORM set_config('TimeZone', 'America/New_York', true);
      v_tz_res2 := public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        v_tz_slot + interval '2 hours',
        'req-8d-resched'
      );
      PERFORM set_config('TimeZone', 'UTC', true);
      PERFORM pg_temp.assert_true(
        (v_tz_res2 ->> 'idempotent_replay')::boolean
        AND (v_tz_res2 ->> 'reservation_id') = (v_tz_res1 ->> 'reservation_id'),
        'reschedule retry across different session TimeZones must succeed idempotently'
      );

      -- Fill v_today_lagos + 1 as well (v_today_lagos + 1 has 1 scheduled post from Merchant C's tomorrow? No: seed 1 on v_today_lagos + 1 and 1 on v_today_lagos + 2, leave +3 free)
      INSERT INTO public.blog_posts (
        id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
      ) VALUES
        (
          'd3000000-0000-4000-8000-000000000018',
          'd2000000-0000-4000-8000-000000000003',
          'Full Tomorrow Blocker', 'full-tomorrow-blocker', 'Blocker 1', 'Editor C', 'scheduled',
          ((v_today_lagos + 1)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          ((v_today_lagos + 1)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          'e1000000-0000-4000-8000-000000000018'
        ),
        (
          'd3000000-0000-4000-8000-000000000019',
          'd2000000-0000-4000-8000-000000000003',
          'Full DayAfter Blocker', 'full-dayafter-blocker', 'Blocker 2', 'Editor C', 'scheduled',
          ((v_today_lagos + 2)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          ((v_today_lagos + 2)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          'e1000000-0000-4000-8000-000000000019'
        ),
        (
          'd3000000-0000-4000-8000-000000000020',
          'd2000000-0000-4000-8000-000000000003',
          'Multi Day Rollover', 'multi-day-rollover', 'Rollover', 'Editor C', 'scheduled',
          v_now - interval '4 hours',
          v_now - interval '4 hours',
          'e1000000-0000-4000-8000-000000000020'
        );
      INSERT INTO private.blog_release_reservations (
        merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
        release_class, requested_publish_at, reserved_lagos_date,
        daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
      ) VALUES (
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000020',
        'e1000000-0000-4000-8000-000000000020',
        'req-8d-multiday',
        repeat('c', 64),
        'policy-2026-11',
        'evergreen',
        v_now - interval '4 hours',
        v_yesterday_lagos,
        1, 2, 1, 0, 'reserved'
      );
      UPDATE public.blog_posts
      SET status = 'published'
      WHERE id = 'd3000000-0000-4000-8000-000000000020'
      RETURNING * INTO v_multi_row;
      PERFORM pg_temp.assert_true(
        v_multi_row.status = 'scheduled',
        'multi-day full rollover remains scheduled'
      );
      PERFORM pg_temp.assert_true(
        (SELECT state = 'deferred' AND reserved_lagos_date = v_today_lagos + 3
         FROM private.blog_release_reservations WHERE request_id = 'req-8d-multiday'),
        'multi-day rollover skips full +1 and +2 days and reserves first available date (+3)'
      );
    END;
  END;
END $$;

DO $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  -- 8f. Archiving a reserved post blocks rescheduling
  UPDATE public.blog_posts
  SET status = 'archived'
  WHERE id = 'd3000000-0000-4000-8000-000000000014';

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000014',
        %L::timestamptz,
        'req-8f-archived-resched'
      )$sql$,
      (v_now + interval '2 days')::text
    ),
    '22023',
    'blog_post_archived',
    'archived reserved post cannot be rescheduled'
  );
END $$;

ROLLBACK;
