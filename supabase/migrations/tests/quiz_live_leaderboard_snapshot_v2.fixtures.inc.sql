-- Included by quiz_live_leaderboard_snapshot_v2.sql (inside its transaction,
-- in replica mode).
-- Owner, three testers (rank 5, rank 120, no result yet) and one outsider.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT fixture.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', fixture.email, 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
FROM (VALUES
  ('79000000-0000-4000-8000-000000000000'::uuid, 'quiz-snapshot-owner@example.com'),
  ('79000000-0000-4000-8000-000000000005'::uuid, 'quiz-snapshot-top@example.com'),
  ('79000000-0000-4000-8000-000000000120'::uuid, 'quiz-snapshot-deep@example.com'),
  ('79000000-0000-4000-8000-000000000998'::uuid, 'quiz-snapshot-waiting@example.com'),
  ('79000000-0000-4000-8000-000000000999'::uuid, 'quiz-snapshot-outsider@example.com')
) AS fixture(id, email);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES ('79000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000000',
  'quiz-snapshot-merchant@example.com', 'Quiz snapshot test', 'quiz-snapshot-test');

INSERT INTO public.customers (id, merchant_id, user_id, email, username) VALUES
  ('79000000-0000-4000-a000-000000000005', '79000000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000005', 'quiz-snapshot-top@example.com', 'player5'),
  ('79000000-0000-4000-a000-000000000120', '79000000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000120', 'quiz-snapshot-deep@example.com', 'player120'),
  ('79000000-0000-4000-a000-000000000998', '79000000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000998', 'quiz-snapshot-waiting@example.com', 'player998'),
  ('79000000-0000-4000-a000-000000000999', '79000000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000999', 'quiz-snapshot-outsider@example.com', 'player999');

INSERT INTO public.quiz_events (id, merchant_id, slug, title, status, starts_at,
  ends_at, mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone)
VALUES ('79000000-0000-4000-8000-000000000003',
  '79000000-0000-4000-8000-000000000001', 'quiz-live-snapshot',
  'Quiz live snapshot', 'active', now() - interval '1 minute',
  now() + interval '5 minutes', 'test', 2, 'snapshot-v2', 20, 10, 200, 360,
  1, 'Africa/Lagos');

INSERT INTO public.quiz_event_testers (event_id, merchant_id, user_id)
SELECT '79000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000001', tester.id
FROM (VALUES
  ('79000000-0000-4000-8000-000000000005'::uuid),
  ('79000000-0000-4000-8000-000000000120'::uuid),
  ('79000000-0000-4000-8000-000000000998'::uuid)
) AS tester(id);

-- 150 finished players. Player n has rank n: ten players per score from 20
-- down to 6, each slower than the one before.
INSERT INTO public.quiz_live_standings_v2 (event_id, customer_id, attempt_id,
  score, total_time_milliseconds, submitted_at, leaderboard_username, attempt_status)
SELECT '79000000-0000-4000-8000-000000000003',
  ('79000000-0000-4000-a000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('79000000-0000-4000-9000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  20 - (n - 1) / 10, 1000 * n,
  now() - interval '1 hour' + n * interval '1 second',
  CASE WHEN n = 2 THEN '   ' ELSE 'player' || n END, 'submitted'
FROM pg_catalog.generate_series(1, 150) AS n;

-- Two exact ties with player 120 (same score and time): one submitted a
-- second earlier (ranks ahead), one with a later attempt id (ranks behind).
INSERT INTO public.quiz_live_standings_v2 (event_id, customer_id, attempt_id,
  score, total_time_milliseconds, submitted_at, leaderboard_username, attempt_status)
SELECT '79000000-0000-4000-8000-000000000003', tie.customer_id, tie.attempt_id,
  9, 120000, now() - interval '1 hour' + 120 * interval '1 second' - tie.earlier,
  tie.username, 'submitted'
FROM (VALUES
  ('79000000-0000-4000-a000-000000000201'::uuid, '79000000-0000-4000-9000-000000000201'::uuid,
   interval '1 second', 'tieahead'),
  ('79000000-0000-4000-a000-000000000202'::uuid, '79000000-0000-4000-9000-ffffffffffff'::uuid,
   interval '0 seconds', 'tiebehind')
) AS tie(customer_id, attempt_id, earlier, username);

-- The leader's identity is suppressed; player 2 has a blank username.
INSERT INTO public.quiz_leaderboard_identity_suppressions (attempt_id, event_id,
  customer_id, merchant_id, reason, suppressed_by)
VALUES ('79000000-0000-4000-9000-000000000001', '79000000-0000-4000-8000-000000000003',
  '79000000-0000-4000-a000-000000000001', '79000000-0000-4000-8000-000000000001',
  'snapshot regression', '79000000-0000-4000-8000-000000000000');
