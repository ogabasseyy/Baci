-- REGRESSION TEST: quiz players no longer queue behind one another on the
-- event row, the closing paths still exclude them, and time spent queueing is
-- not charged to an answer.
--
-- Three extra sessions (dblink): A and B are two players, C plays the closer.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT public.dblink_connect('quiz_par_a', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));
SELECT public.dblink_connect('quiz_par_b', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));
SELECT public.dblink_connect('quiz_par_c', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));

-- Fixtures (committed, three sessions must see them) and the cleanup helper.
\ir quiz_parallel_player_event_locks_v2.fixtures.inc.sql

-- 1. Static guard: each player function shares the event row exactly once and
--    never asks for the exclusive event lock.
DO $$
DECLARE
  v_checked integer := 0;
  v_function record;
BEGIN
  FOR v_function IN
    SELECT proc.oid::regprocedure::text AS name, proc.prosrc
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE (namespace.nspname, proc.proname) IN (
      ('private', 'quiz_attempt_state_v2'),
      ('private', 'quiz_bind_attempt_device_v2'),
      ('private', 'start_quiz_attempt_v2_core'),
      ('public', 'start_quiz_attempt_with_device_v2'),
      ('public', 'submit_quiz_answer_v2'),
      ('public', 'resume_quiz_attempt_v2')
    )
  LOOP
    v_checked := v_checked + 1;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(v_function.prosrc, 'FOR SHARE', 'g')) <> 1
      OR v_function.prosrc ~ 'FOR UPDATE OF event'
      OR v_function.prosrc ~ 'WHERE event\.id = p_event_id\s+(AND event\.contract_version = 2\s+)?FOR UPDATE' THEN
      RAISE EXCEPTION 'player function % still takes the exclusive event lock', v_function.name;
    END IF;
  END LOOP;
  IF v_checked <> 6 THEN
    RAISE EXCEPTION 'expected 6 player functions, checked %', v_checked;
  END IF;
END;
$$;

-- Signed route proofs, remote-call helpers and per-session settings.
\ir quiz_parallel_player_event_locks_v2.helpers.inc.sql

-- 2. Two starts overlap: A starts and keeps its transaction open, B starts
--    and finishes meanwhile. Covers the device wrapper, the start core,
--    device binding and the attempt-state projection.
SELECT public.dblink_exec('quiz_par_a', 'BEGIN');
SELECT pg_temp.quiz_par_record('a', pg_temp.quiz_par_remote('quiz_par_a',
  pg_temp.quiz_par_start_sql('78000000-0000-4000-8000-00000000000a', pg_catalog.repeat('a', 64))));
SELECT pg_temp.quiz_par_record('b', pg_temp.quiz_par_remote('quiz_par_b',
  pg_temp.quiz_par_start_sql('78000000-0000-4000-8000-00000000000b', pg_catalog.repeat('b', 64))));

-- 3. B can also resume while A is still open.
DO $$
DECLARE
  v_resume jsonb;
BEGIN
  v_resume := pg_temp.quiz_par_remote('quiz_par_b',
    $remote$SELECT public.resume_quiz_attempt_v2('78000000-0000-4000-8000-000000000003'::uuid, NULL)$remote$);
  IF v_resume->>'availability' <> 'active' THEN
    RAISE EXCEPTION 'resume beside an open player transaction failed: %', v_resume;
  END IF;
END;
$$;

-- 4. A closing path (FOR UPDATE SKIP LOCKED) must not get the event while a
--    player transaction is open, and must get it once the player is done.
DO $$
BEGIN
  PERFORM 1 FROM public.quiz_events
  WHERE id = '78000000-0000-4000-8000-000000000003'
  FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    RAISE EXCEPTION 'a closer locked the event while a player was in flight';
  END IF;
END;
$$;
SELECT public.dblink_exec('quiz_par_a', 'COMMIT');
DO $$
BEGIN
  PERFORM 1 FROM public.quiz_events
  WHERE id = '78000000-0000-4000-8000-000000000003'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a closer could not lock an idle event';
  END IF;
END;
$$;

-- 5. Two answers overlap the same way.
SELECT public.dblink_exec('quiz_par_a', 'BEGIN');
SELECT pg_temp.quiz_par_record('a', pg_temp.quiz_par_remote('quiz_par_a',
  pg_temp.quiz_par_answer_sql(player.user_id, player.attempt_id, player.question_id, 'a')))
FROM quiz_par_player AS player WHERE player.player = 'a';
SELECT pg_temp.quiz_par_record('b', pg_temp.quiz_par_remote('quiz_par_b',
  pg_temp.quiz_par_answer_sql(player.user_id, player.attempt_id, player.question_id, 'a')))
FROM quiz_par_player AS player WHERE player.player = 'b';
SELECT public.dblink_exec('quiz_par_a', 'COMMIT');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM quiz_par_player WHERE question_id IS NULL) THEN
    RAISE EXCEPTION 'both players should be on question two';
  END IF;
END;
$$;

-- 6. While a closer holds the event, a player waits (and here times out).
SELECT public.dblink_exec('quiz_par_c', 'BEGIN');
SELECT public.dblink_exec('quiz_par_c', $remote$
  DO $block$
  BEGIN
    PERFORM 1 FROM public.quiz_events
    WHERE id = '78000000-0000-4000-8000-000000000003'
    FOR UPDATE;
  END
  $block$
$remote$);
SELECT public.dblink_exec('quiz_par_b', $$SET lock_timeout = '300ms'$$);
DO $$
DECLARE
  v_message text;
  v_rows integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_rows
  FROM public.dblink('quiz_par_b',
    $remote$SELECT public.resume_quiz_attempt_v2('78000000-0000-4000-8000-000000000003'::uuid, NULL)$remote$,
    false) AS result(value jsonb);
  v_message := public.dblink_error_message('quiz_par_b');
  IF v_rows <> 0 OR v_message !~* 'lock timeout' THEN
    RAISE EXCEPTION 'a player ran while a closer held the event (rows %, message %)', v_rows, v_message;
  END IF;
END;
$$;
SELECT public.dblink_exec('quiz_par_b', $$SET lock_timeout = 0$$);

-- 7. Queue time is not charged. B's question two has 5 of its 10 seconds
--    left. B answers correctly now, but stays blocked behind the closer until
--    the deadline has passed. The answer must still count as on time.
UPDATE public.quiz_attempt_questions AS question
SET issued_at = pg_catalog.clock_timestamp() - interval '5 seconds'
FROM quiz_par_player AS player
WHERE player.player = 'b' AND question.id = player.question_id;

CREATE TEMP TABLE quiz_par_backend AS
SELECT result.pid FROM public.dblink('quiz_par_b', 'SELECT pg_backend_pid()') AS result(pid integer);

SELECT public.dblink_send_query('quiz_par_b',
  pg_temp.quiz_par_answer_sql(player.user_id, player.attempt_id, player.question_id, 'a'))
FROM quiz_par_player AS player WHERE player.player = 'b';

DO $$
DECLARE
  v_tries integer := 0;
BEGIN
  LOOP
    -- pg_locks is read fresh on every call; pg_stat_activity is cached for the
    -- whole transaction and would keep showing the first observation.
    EXIT WHEN EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks AS waiting
      JOIN quiz_par_backend AS backend ON backend.pid = waiting.pid
      WHERE NOT waiting.granted
    );
    v_tries := v_tries + 1;
    IF v_tries > 150 THEN
      RAISE EXCEPTION 'the queued answer never waited behind the closer';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;

SELECT pg_catalog.pg_sleep(6);
SELECT public.dblink_exec('quiz_par_c', 'COMMIT');

DO $$
DECLARE
  v_tries integer := 0;
BEGIN
  WHILE public.dblink_is_busy('quiz_par_b') = 1 LOOP
    v_tries := v_tries + 1;
    IF v_tries > 750 THEN
      RAISE EXCEPTION 'the queued answer did not finish after the closer left';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;
SELECT result.value->>'status' AS queued_answer_status
FROM public.dblink_get_result('quiz_par_b') AS result(value jsonb);
SELECT pg_catalog.count(*) AS drained
FROM public.dblink_get_result('quiz_par_b') AS result(value jsonb);

DO $$
DECLARE
  v_answer public.quiz_attempt_answers%ROWTYPE;
  v_attempt public.quiz_attempts%ROWTYPE;
BEGIN
  SELECT answer.* INTO v_answer
  FROM public.quiz_attempt_answers AS answer
  JOIN quiz_par_player AS player ON player.question_id = answer.attempt_question_id
  WHERE player.player = 'b';
  IF v_answer.id IS NULL THEN
    RAISE EXCEPTION 'the queued answer was not recorded';
  END IF;
  IF v_answer.score_delta <> 1
    OR (v_answer.answer_payload->>'late')::boolean
    OR v_answer.answered_in_ms NOT BETWEEN 5000 AND 9999 THEN
    RAISE EXCEPTION 'queue time was charged to the player: score %, payload %, ms %',
      v_answer.score_delta, v_answer.answer_payload, v_answer.answered_in_ms;
  END IF;
  SELECT attempt.* INTO v_attempt
  FROM public.quiz_attempts AS attempt
  JOIN quiz_par_player AS player ON player.attempt_id = attempt.id
  WHERE player.player = 'b';
  IF v_attempt.status <> 'submitted' OR v_attempt.score <> 2 THEN
    RAISE EXCEPTION 'player B should finish with 2 points, got % (%)',
      v_attempt.score, v_attempt.status;
  END IF;
END;
$$;

-- 8. Control: an answer that really arrives after the deadline is still late.
UPDATE public.quiz_attempt_questions AS question
SET issued_at = pg_catalog.clock_timestamp() - interval '11 seconds'
FROM quiz_par_player AS player
WHERE player.player = 'a' AND question.id = player.question_id;

SELECT pg_temp.quiz_par_remote('quiz_par_a',
  pg_temp.quiz_par_answer_sql(player.user_id, player.attempt_id, player.question_id, 'a'))->>'status'
  AS late_answer_status
FROM quiz_par_player AS player WHERE player.player = 'a';

DO $$
DECLARE
  v_answer public.quiz_attempt_answers%ROWTYPE;
  v_score integer;
BEGIN
  SELECT answer.* INTO v_answer
  FROM public.quiz_attempt_answers AS answer
  JOIN quiz_par_player AS player ON player.question_id = answer.attempt_question_id
  WHERE player.player = 'a';
  IF v_answer.id IS NULL
    OR v_answer.score_delta <> 0
    OR NOT (v_answer.answer_payload->>'late')::boolean THEN
    RAISE EXCEPTION 'a truly late answer must score 0 and be marked late: % %',
      v_answer.score_delta, v_answer.answer_payload;
  END IF;
  SELECT attempt.score INTO v_score
  FROM public.quiz_attempts AS attempt
  JOIN quiz_par_player AS player ON player.attempt_id = attempt.id
  WHERE player.player = 'a';
  IF v_score <> 1 THEN
    RAISE EXCEPTION 'player A should finish with 1 point, got %', v_score;
  END IF;
END;
$$;

SELECT public.dblink_disconnect('quiz_par_a');
SELECT public.dblink_disconnect('quiz_par_b');
SELECT public.dblink_disconnect('quiz_par_c');
SELECT pg_temp.quiz_par_cleanup();
