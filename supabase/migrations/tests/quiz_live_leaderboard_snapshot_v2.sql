-- REGRESSION TEST: the live quiz leaderboard is served from one shared
-- snapshot per event (top 100, participant count, per-score histogram), a
-- caller's own rank stays exact, names keep their privacy rules, and the
-- snapshot table is not readable by clients.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;

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

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$$;

CREATE FUNCTION pg_temp.board() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.get_quiz_live_leaderboard_public_v2(
    '79000000-0000-4000-8000-000000000003'::uuid);
$$;

CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'failed: % (%)', p_label, COALESCE(p_detail, 'no detail');
  END IF;
END;
$$;

-- 1. A player far outside the top 100, with ties around them.
SELECT pg_temp.as_user('79000000-0000-4000-8000-000000000120');
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
  v_expected_rank bigint;
BEGIN
  SELECT ranked.rank INTO v_expected_rank
  FROM (
    SELECT live.customer_id, pg_catalog.row_number() OVER (
      ORDER BY live.score DESC, live.total_time_milliseconds,
        live.submitted_at, live.attempt_id) AS rank
    FROM public.quiz_live_standings_v2 AS live
    WHERE live.event_id = '79000000-0000-4000-8000-000000000003'
  ) AS ranked
  WHERE ranked.customer_id = '79000000-0000-4000-a000-000000000120';

  PERFORM pg_temp.expect('status', v_board->>'status' = 'live');
  PERFORM pg_temp.expect('top 100 only',
    pg_catalog.jsonb_array_length(v_board->'entries') = 100);
  PERFORM pg_temp.expect('ranks run 1..100',
    (v_board->'entries'->0->>'rank')::integer = 1
      AND (v_board->'entries'->99->>'rank')::integer = 100
      AND (v_board->'entries'->99->>'customer_name') = 'player100');
  PERFORM pg_temp.expect('suppressed leader shows an alias',
    v_board->'entries'->0->>'customer_name' ~ '^Player-[0-9A-F]{8}$',
    v_board->'entries'->0->>'customer_name');
  PERFORM pg_temp.expect('blank username shows an alias',
    v_board->'entries'->1->>'customer_name' ~ '^Player-[0-9A-F]{8}$',
    v_board->'entries'->1->>'customer_name');
  PERFORM pg_temp.expect('normal name kept',
    v_board->'entries'->2->>'customer_name' = 'player3');
  PERFORM pg_temp.expect('no customer id leaves the database',
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_board->'entries') AS entry
      WHERE entry ? 'customer_id'
    ) AND NOT (v_board->'current_player' ? 'customer_id'));
  PERFORM pg_temp.expect('nobody in the top 100 is flagged as the caller',
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_board->'entries') AS entry
      WHERE (entry->>'is_current_customer')::boolean
    ));
  PERFORM pg_temp.expect('own rank is exact, including ties',
    v_expected_rank = 121
      AND (v_board->'current_player'->>'rank')::bigint = v_expected_rank,
    (v_board->'current_player')::text);
  PERFORM pg_temp.expect('own row',
    (v_board->'current_player'->>'is_current_customer')::boolean
      AND v_board->'current_player'->>'customer_name' = 'player120'
      AND (v_board->'current_player'->>'score')::integer = 9
      AND (v_board->'current_player'->>'total_time_seconds')::numeric = 120);
  PERFORM pg_temp.expect('participant count',
    (v_board->>'participant_count')::integer = 152, v_board->>'participant_count');
END;
$$;

-- 2. A player inside the top 100 is flagged once and gets the same rank.
SELECT pg_temp.as_user('79000000-0000-4000-8000-000000000005');
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
BEGIN
  PERFORM pg_temp.expect('flagged at rank 5',
    (v_board->'entries'->4->>'is_current_customer')::boolean
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_board->'entries') AS entry
           WHERE (entry->>'is_current_customer')::boolean) = 1);
  PERFORM pg_temp.expect('current player matches the list',
    (v_board->'current_player'->>'rank')::integer = 5
      AND v_board->'current_player'->>'customer_name' = 'player5');
END;
$$;

-- 3. A tester who has not finished sees the board without a row of their own.
SELECT pg_temp.as_user('79000000-0000-4000-8000-000000000998');
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
BEGIN
  PERFORM pg_temp.expect('no own row yet',
    v_board->'current_player' = 'null'::jsonb
      AND pg_catalog.jsonb_array_length(v_board->'entries') = 100);
END;
$$;

-- 4. Access rules are unchanged: a customer who is not a tester is refused.
SELECT pg_temp.as_user('79000000-0000-4000-8000-000000000999');
DO $$
DECLARE
  v_state text := 'allowed';
BEGIN
  BEGIN
    PERFORM pg_temp.board();
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  PERFORM pg_temp.expect('outsider refused', v_state = 'QZ031', v_state);
END;
$$;

-- 5. One stored row serves everyone until it is stale; then it is rebuilt.
SELECT pg_temp.as_user('79000000-0000-4000-8000-000000000120');
SET LOCAL session_replication_role = replica;
UPDATE public.quiz_live_leaderboard_snapshots_v2
SET computed_at = pg_catalog.clock_timestamp() + interval '1 hour'
WHERE event_id = '79000000-0000-4000-8000-000000000003';
INSERT INTO public.quiz_live_standings_v2 (event_id, customer_id, attempt_id,
  score, total_time_milliseconds, submitted_at, leaderboard_username, attempt_status)
VALUES ('79000000-0000-4000-8000-000000000003',
  '79000000-0000-4000-a000-000000000300', '79000000-0000-4000-9000-000000000300',
  21, 500, now(), 'newleader', 'submitted');
SET LOCAL session_replication_role = origin;
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
BEGIN
  PERFORM pg_temp.expect('exactly one snapshot row',
    (SELECT pg_catalog.count(*) FROM public.quiz_live_leaderboard_snapshots_v2
     WHERE event_id = '79000000-0000-4000-8000-000000000003') = 1);
  PERFORM pg_temp.expect('fresh snapshot is reused',
    (v_board->'entries'->0->>'score')::integer = 20
      AND (v_board->>'participant_count')::integer = 152);
END;
$$;
SET LOCAL session_replication_role = replica;
UPDATE public.quiz_live_leaderboard_snapshots_v2
SET computed_at = pg_catalog.clock_timestamp() - interval '1 minute'
WHERE event_id = '79000000-0000-4000-8000-000000000003';
SET LOCAL session_replication_role = origin;
DO $$
DECLARE
  v_board jsonb := pg_temp.board();
BEGIN
  PERFORM pg_temp.expect('stale snapshot is rebuilt',
    v_board->'entries'->0->>'customer_name' = 'newleader'
      AND (v_board->>'participant_count')::integer = 153
      AND (v_board->'current_player'->>'rank')::integer = 122,
    (v_board->'current_player')::text);
END;
$$;

-- 6. The count endpoint: snapshot while live, exact count without a fresh
--    snapshot, highest rank once published.
DO $$
DECLARE
  v_event constant uuid := '79000000-0000-4000-8000-000000000003';
BEGIN
  PERFORM pg_temp.expect('live count from the snapshot',
    public.get_quiz_participant_count_public_v2(v_event) = 153);
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.quiz_live_leaderboard_snapshots_v2 WHERE event_id = v_event;
  PERFORM pg_temp.expect('live count without a snapshot',
    public.get_quiz_participant_count_public_v2(v_event) = 153);
  INSERT INTO public.quiz_event_results_v2 (event_id, attempt_id, customer_id, rank,
    score, total_time_seconds, total_time_milliseconds, submitted_at, attempt_status)
  SELECT v_event, live.attempt_id, live.customer_id, n.rank, live.score,
    live.total_time_milliseconds / 1000.0, live.total_time_milliseconds,
    live.submitted_at, live.attempt_status
  FROM (VALUES (1, 1), (2, 2), (3, 3)) AS n(rank, player)
  JOIN public.quiz_live_standings_v2 AS live
    ON live.event_id = v_event
    AND live.customer_id = ('79000000-0000-4000-a000-' || pg_catalog.lpad(n.player::text, 12, '0'))::uuid;
  UPDATE public.quiz_events SET results_published_at = now() WHERE id = v_event;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.expect('published count is the highest rank',
    public.get_quiz_participant_count_public_v2(v_event) = 3);
END;
$$;

-- 7. Clients cannot read the snapshot table or call the refresher.
SELECT pg_temp.expect('snapshot table closed to clients',
  NOT pg_catalog.has_table_privilege('authenticated', 'public.quiz_live_leaderboard_snapshots_v2', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.quiz_live_leaderboard_snapshots_v2', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_catalog.pg_class
       WHERE oid = 'public.quiz_live_leaderboard_snapshots_v2'::regclass));
SELECT pg_temp.expect('function grants',
  pg_catalog.has_function_privilege('authenticated', 'public.get_quiz_live_leaderboard_public_v2(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.get_quiz_live_leaderboard_public_v2(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'private.refresh_quiz_live_leaderboard_snapshot_v2(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.get_quiz_participant_count_public_v2(uuid)', 'EXECUTE'));

ROLLBACK;
