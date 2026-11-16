BEGIN;
\ir blog_release_reservations_setup.inc.sql

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- 7. Finalization trigger: non-pilot fallback + expired fast-track news + spacing deferral (including 2-row batch) + midnight rollover
DO $$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_today_lagos date := (v_now AT TIME ZONE 'Africa/Lagos')::date;
  v_yesterday_lagos date := v_today_lagos - 1;
  v_non_pilot_row public.blog_posts%ROWTYPE;
  v_platform_row public.blog_posts%ROWTYPE;
  v_expired_row public.blog_posts%ROWTYPE;
  v_batch_row_1 public.blog_posts%ROWTYPE;
  v_batch_row_2 public.blog_posts%ROWTYPE;
  v_rollover_ok public.blog_posts%ROWTYPE;
  v_rollover_full public.blog_posts%ROWTYPE;
BEGIN
  -- 7a. Non-pilot scheduled post & platform post without reservation publish normally
  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000009'
  RETURNING * INTO v_non_pilot_row;

  PERFORM pg_temp.assert_true(v_non_pilot_row.status = 'published', 'non-pilot post publishes without reservation');
  PERFORM pg_temp.assert_true(v_non_pilot_row.published_at = v_now, 'non-pilot published_at becomes transaction_timestamp()');
  PERFORM pg_temp.assert_true(v_non_pilot_row.requested_publish_at = v_now - interval '5 minutes', 'non-pilot preserves original requested_publish_at');

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000098'
  RETURNING * INTO v_platform_row;
  PERFORM pg_temp.assert_true(v_platform_row.status = 'published', 'platform post publishes without reservation');

  -- 7b. Expired fast-track news (>12h at cron time) -> held as draft + held_expired_news
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000010',
    'd2000000-0000-4000-8000-000000000002',
    'Expired News Post', 'expired-news-post', 'News content', 'Editor B', 'scheduled',
    v_now - interval '1 minute',
    v_now - interval '1 minute',
    'e1000000-0000-4000-8000-000000000010'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date, event_published_at,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000010',
    'req-expired-news',
    repeat('4', 64),
    'policy-2026-11',
    'fast_track_news',
    v_now - interval '1 minute',
    v_today_lagos,
    v_now - interval '12 hours 5 minutes',
    3, 2, 1, 30, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000010'
  RETURNING * INTO v_expired_row;

  PERFORM pg_temp.assert_true(v_expired_row.status = 'draft', 'expired fast-track news held as draft');
  PERFORM pg_temp.assert_true(v_expired_row.published_at IS NULL, 'expired fast-track news clears published_at');
  PERFORM pg_temp.assert_true(v_expired_row.requested_publish_at = v_now - interval '1 minute', 'expired fast-track news preserves requested_publish_at');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'held_expired_news' FROM private.blog_release_reservations WHERE request_id = 'req-expired-news'),
    'reservation marks state=held_expired_news'
  );

  -- 7c. Batch update of two due scheduled reserved posts on Merchant B:
  --     First publishes at v_now; second sees first within 30m and defers cleanly to v_now + 30m.
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES
    ('d3000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000002', 'Batch 1', 'batch-1', 'Batch content 1', 'Editor B', 'scheduled', v_now - interval '2 minutes', v_now - interval '2 minutes', 'e1000000-0000-4000-8000-000000000011'),
    ('d3000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000002', 'Batch 2', 'batch-2', 'Batch content 2', 'Editor B', 'scheduled', v_now - interval '1 minute', v_now - interval '1 minute', 'e1000000-0000-4000-8000-000000000012');

  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES
    ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000011', 'req-batch-1', repeat('5', 64), 'policy-2026-11', 'standard', v_now - interval '2 minutes', v_today_lagos, 3, 2, 1, 30, 'reserved'),
    ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000012', 'req-batch-2', repeat('6', 64), 'policy-2026-11', 'evergreen', v_now - interval '1 minute', v_today_lagos, 3, 2, 1, 30, 'reserved');

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id IN ('d3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000012');

  SELECT * INTO v_batch_row_1 FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000011';
  SELECT * INTO v_batch_row_2 FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000012';

  PERFORM pg_temp.assert_true(
    (v_batch_row_1.status = 'published' AND v_batch_row_2.status = 'scheduled')
    OR (v_batch_row_2.status = 'published' AND v_batch_row_1.status = 'scheduled'),
    'exactly one batch row publishes and the second defers for 30m spacing'
  );
  IF v_batch_row_1.status = 'published' THEN
    PERFORM pg_temp.assert_true(v_batch_row_2.published_at = v_now + interval '30 minutes', 'deferred batch row next_evaluation_at is v_now + 30m');
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'min_spacing_active' FROM private.blog_release_reservations WHERE request_id = 'req-batch-2'),
      'deferred reservation records min_spacing_active'
    );
    -- Re-polling deferred row immediately stays bounded at v_now + 30m
    UPDATE public.blog_posts SET status = 'published' WHERE id = 'd3000000-0000-4000-8000-000000000012' RETURNING * INTO v_batch_row_2;
    PERFORM pg_temp.assert_true(v_batch_row_2.status = 'scheduled' AND v_batch_row_2.published_at = v_now + interval '30 minutes', 'repeated polling keeps bounded next_evaluation_at');
  ELSE
    PERFORM pg_temp.assert_true(v_batch_row_1.published_at = v_now + interval '30 minutes', 'deferred batch row next_evaluation_at is v_now + 30m');
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'min_spacing_active' FROM private.blog_release_reservations WHERE request_id = 'req-batch-1'),
      'deferred reservation records min_spacing_active'
    );
  END IF;

  -- Clear spacing conflict by shifting already-published batch row to 2 hours ago, then test midnight rollover capacity:
  -- Merchant B currently has 1 published today and 1 scheduled today (total_used on v_today_lagos = 2).
  -- Backdate the published row to earlier today UTC/Lagos (at least 40m ago; if near 00:00 Lagos, keep it on v_yesterday_lagos or adjust cap).
  -- To be 100% independent of wall-clock time-of-day, create Merchant C for clean midnight-rollover assertions!
  INSERT INTO public.merchants (id, email, user_id, business_name, slug)
  VALUES ('d2000000-0000-4000-8000-000000000003', 'track1-c@example.invalid', NULL, 'Merchant C', 'merchant-c');

  -- 7d. Midnight rollover with available capacity on v_today_lagos -> publishes & updates reserved_lagos_date
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000013',
    'd2000000-0000-4000-8000-000000000003',
    'Rollover OK', 'rollover-ok', 'Rollover ok content', 'Editor C', 'scheduled',
    v_now - interval '3 hours',
    v_now - interval '3 hours',
    'e1000000-0000-4000-8000-000000000013'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000003',
    'd3000000-0000-4000-8000-000000000013',
    'e1000000-0000-4000-8000-000000000013',
    'req-rollover-ok',
    repeat('7', 64),
    'policy-2026-11',
    'evergreen',
    v_now - interval '3 hours',
    v_yesterday_lagos,
    2, 2, 1, 30, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000013'
  RETURNING * INTO v_rollover_ok;

  PERFORM pg_temp.assert_true(v_rollover_ok.status = 'published', 'rollover with free capacity on today Lagos date publishes');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND reserved_lagos_date = v_today_lagos FROM private.blog_release_reservations WHERE request_id = 'req-rollover-ok'),
    'rollover updates reserved_lagos_date to today Lagos date'
  );

  -- 7e. Midnight rollover when destination Lagos day is already at cap (daily_cap=1, already 1 published today on Merchant C)
  -- Move v_rollover_ok's published_at outside the 30m spacing window ONLY if still on v_today_lagos, OR set min_spacing_minutes=0 on the next reservation so capacity check runs directly!
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000014',
    'd2000000-0000-4000-8000-000000000003',
    'Rollover Over Cap', 'rollover-over-cap', 'Rollover cap content', 'Editor C', 'scheduled',
    v_now - interval '3 hours',
    v_now - interval '3 hours',
    'e1000000-0000-4000-8000-000000000014'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000003',
    'd3000000-0000-4000-8000-000000000014',
    'e1000000-0000-4000-8000-000000000014',
    'req-rollover-cap',
    repeat('8', 64),
    'policy-2026-11',
    'evergreen',
    v_now - interval '3 hours',
    v_yesterday_lagos,
    1, 2, 1, 0, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000014'
  RETURNING * INTO v_rollover_full;

  PERFORM pg_temp.assert_true(v_rollover_full.status = 'scheduled', 'rollover over destination Lagos cap defers to scheduled');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'deferred' AND defer_reason = 'daily_cap_exceeded' AND reserved_lagos_date = v_today_lagos + 1
     FROM private.blog_release_reservations WHERE request_id = 'req-rollover-cap'),
    'rollover over cap marks deferred with daily_cap_exceeded and tomorrow Lagos date'
  );

END $$;

-- 8e. Same-day reserved post respects daily_cap when another draft is manually published earlier the same day
INSERT INTO public.merchants (id, email, user_id, business_name, slug)
VALUES ('d2000000-0000-4000-8000-000000000005', 'track1-e@example.invalid', NULL, 'Merchant E', 'merchant-e');

INSERT INTO public.staff_members (merchant_id, user_id, email, status, permissions)
VALUES ('d2000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'track1-e-staff@example.invalid', 'active', '{"marketing":{"view":true,"edit":true}}'::jsonb);

INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status
) VALUES
  ('d3000000-0000-4000-8000-000000000021', 'd2000000-0000-4000-8000-000000000005', 'Manual Draft E', 'manual-draft-e', 'Draft E', 'Editor E', 'draft'),
  ('d3000000-0000-4000-8000-000000000022', 'd2000000-0000-4000-8000-000000000005', 'Reserved Today E', 'reserved-today-e', 'Reserved E', 'Editor E', 'draft');

SELECT public.reserve_merchant_blog_release_v1(
  'd2000000-0000-4000-8000-000000000005',
  'd3000000-0000-4000-8000-000000000022',
  'e1000000-0000-4000-8000-000000000022',
  'req-8e-reserve',
  repeat('d', 64),
  'policy-2026-11',
  'evergreen',
  transaction_timestamp() - interval '5 minutes',
  NULL, NULL, false, NULL,
  1, 2, 1, 0, 8, 20
) IS NOT NULL AS reserved_8e;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

SELECT id, status, published_at
FROM public.mutate_merchant_blog_post_with_product_links(
  'd3000000-0000-4000-8000-000000000021',
  'd2000000-0000-4000-8000-000000000005',
  jsonb_build_object('status', 'published', 'published_at', transaction_timestamp())
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_today_lagos date := (v_now AT TIME ZONE 'Africa/Lagos')::date;
  v_reserved_today_row public.blog_posts%ROWTYPE;
BEGIN
  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000022'
  RETURNING * INTO v_reserved_today_row;

  PERFORM pg_temp.assert_true(
    v_reserved_today_row.status = 'scheduled',
    'same-day reserved post must defer when a manual publish already consumed daily_cap'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'deferred' AND defer_reason = 'daily_cap_exceeded' AND reserved_lagos_date = v_today_lagos + 1
     FROM private.blog_release_reservations WHERE request_id = 'req-8e-reserve'),
    'same-day manual publish collision records daily_cap_exceeded and defers to tomorrow'
  );

END $$;

ROLLBACK;
