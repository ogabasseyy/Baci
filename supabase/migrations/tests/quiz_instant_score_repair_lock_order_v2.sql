-- REGRESSION TEST: timeout/resume and score repair share table-first order.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT public.dblink_connect('quiz_timeout_blocker', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));
SELECT public.dblink_connect('quiz_timeout_resume', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));
SELECT public.dblink_connect('quiz_score_repair', pg_catalog.format('hostaddr=%s port=%s dbname=postgres user=postgres password=postgres', pg_catalog.inet_server_addr(), pg_catalog.inet_server_port()));

SET session_replication_role = replica;
DO $$
BEGIN
  DELETE FROM public.quiz_attempt_answers WHERE attempt_question_id = '75000000-0000-4000-8000-000000000007';
  DELETE FROM public.quiz_attempt_questions WHERE id = '75000000-0000-4000-8000-000000000007';
  DELETE FROM public.quiz_attempts WHERE id = '75000000-0000-4000-8000-000000000006';
  DELETE FROM public.quiz_question_variants WHERE id = '75000000-0000-4000-8000-000000000005';
  DELETE FROM public.quiz_question_slots WHERE id = '75000000-0000-4000-8000-000000000004';
  DELETE FROM public.quiz_events WHERE id = '75000000-0000-4000-8000-000000000003';
  DELETE FROM public.customers WHERE id = '75000000-0000-4000-8000-000000000002';
  DELETE FROM public.merchants WHERE id = '75000000-0000-4000-8000-000000000001';
  DELETE FROM auth.users WHERE id = '75000000-0000-4000-8000-000000000000';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    '75000000-0000-4000-8000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'quiz-lock-order@example.com', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

  INSERT INTO public.merchants (
    id, user_id, email, business_name, slug
  ) VALUES (
    '75000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000000',
    'quiz-lock-order-merchant@example.com',
    'Quiz lock order test', 'quiz-lock-order-test'
  );

  INSERT INTO public.customers (
    id, merchant_id, user_id, email, username
  ) VALUES (
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000000',
    'quiz-lock-order@example.com', 'lockordertester'
  );

  INSERT INTO public.quiz_events (
    id, merchant_id, slug, title, status, starts_at, ends_at,
    mode, contract_version, rules_version, question_count,
    time_per_question_seconds, maximum_play_seconds, live_window_seconds,
    max_attempts, time_zone
  ) VALUES (
    '75000000-0000-4000-8000-000000000003',
    '75000000-0000-4000-8000-000000000001',
    'quiz-timeout-lock-order', 'Quiz timeout lock order',
    'active', now() - interval '1 minute', now() + interval '5 minutes',
    'test', 2, 'lock-order-v2', 1, 5, 5, 360, 1, 'Africa/Lagos'
  );

  INSERT INTO public.quiz_question_slots (
    id, event_id, slot_index, active
  ) VALUES (
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000003', 1, true
  );

  INSERT INTO public.quiz_question_variants (
    id, slot_id, variant_key, prompt, options, answer_key_hash, active
  ) VALUES (
    '75000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000004',
    'lock-order', 'Lock order?',
    '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb,
    repeat('a', 64), true
  );

  INSERT INTO public.quiz_attempts (
    id, event_id, customer_id, status, attempt_number,
    leaderboard_username, rules_version, terms_accepted_at,
    app_version, platform
  ) VALUES (
    '75000000-0000-4000-8000-000000000006',
    '75000000-0000-4000-8000-000000000003',
    '75000000-0000-4000-8000-000000000002',
    'started', 1, 'lockordertester', 'lock-order-v2',
    now(), 'migration-test', 'web'
  );

  INSERT INTO public.quiz_attempt_questions (
    id, attempt_id, slot_id, variant_id, position,
    option_order, issued_at, time_limit_ms
  ) VALUES (
    '75000000-0000-4000-8000-000000000007',
    '75000000-0000-4000-8000-000000000006',
    '75000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000005',
    1, '["a","b"]'::jsonb, now() - interval '10 seconds', 5000
  );
END;
$$;
SET session_replication_role = origin;

CREATE OR REPLACE FUNCTION public.try_quiz_score_repair_lock_order_v2(
  p_attempt_id uuid
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  LOCK TABLE public.quiz_attempt_answers IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.quiz_attempts
  SET score = score
  WHERE id = p_attempt_id;
  RETURN 'repaired';
END;
$$;

CREATE TEMP TABLE quiz_lock_order_backend (
  role text PRIMARY KEY,
  pid integer NOT NULL
);
INSERT INTO quiz_lock_order_backend(role, pid)
SELECT 'resume', result.pid
FROM dblink(
  'quiz_timeout_resume',
  'SELECT pg_backend_pid()'
) AS result(pid integer);
INSERT INTO quiz_lock_order_backend(role, pid)
SELECT 'repair', result.pid
FROM dblink(
  'quiz_score_repair',
  'SELECT pg_backend_pid()'
) AS result(pid integer);

SELECT dblink_exec('quiz_timeout_blocker', 'BEGIN');
SELECT dblink_exec(
  'quiz_timeout_blocker',
  $remote$
    DO $block$
    BEGIN
      PERFORM 1
      FROM public.quiz_attempts
      WHERE id = '75000000-0000-4000-8000-000000000006'
      FOR UPDATE;
    END
    $block$
  $remote$
);

SELECT dblink_exec(
  'quiz_timeout_resume',
  $$SET request.jwt.claim.sub = '75000000-0000-4000-8000-000000000000'$$
);
SELECT dblink_exec('quiz_timeout_resume', $$SET statement_timeout = '10s'$$);
SELECT dblink_exec('quiz_timeout_resume', $$SET deadlock_timeout = '100ms'$$);
SELECT dblink_send_query(
  'quiz_timeout_resume',
  $$SELECT public.resume_quiz_attempt_v2(
      '75000000-0000-4000-8000-000000000003'::uuid,
      NULL
    )$$
);

DO $$
DECLARE
  v_pid integer;
  v_tries integer := 0;
BEGIN
  SELECT pid INTO v_pid
  FROM quiz_lock_order_backend
  WHERE role = 'resume';
  LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks
      WHERE pid = v_pid
        AND relation = 'public.quiz_attempt_answers'::regclass
        AND mode = 'RowExclusiveLock'
        AND granted
    );
    v_tries := v_tries + 1;
    IF v_tries > 750 THEN
      RAISE EXCEPTION 'resume never acquired the answer-table writer lock';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;

SELECT dblink_exec('quiz_score_repair', $$SET statement_timeout = '10s'$$);
SELECT dblink_exec('quiz_score_repair', $$SET deadlock_timeout = '100ms'$$);
SELECT dblink_send_query(
  'quiz_score_repair',
  $$SELECT public.try_quiz_score_repair_lock_order_v2(
      '75000000-0000-4000-8000-000000000006'::uuid
    )$$
);

DO $$
DECLARE
  v_pid integer;
  v_tries integer := 0;
BEGIN
  SELECT pid INTO v_pid
  FROM quiz_lock_order_backend
  WHERE role = 'repair';
  LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks
      WHERE pid = v_pid
        AND relation = 'public.quiz_attempt_answers'::regclass
        AND mode = 'ShareRowExclusiveLock'
        AND NOT granted
    );
    v_tries := v_tries + 1;
    IF v_tries > 750 THEN
      RAISE EXCEPTION 'score repair did not wait behind resume table ordering';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;

SELECT dblink_exec('quiz_timeout_blocker', 'COMMIT');

DO $$
DECLARE
  v_tries integer := 0;
BEGIN
  WHILE dblink_is_busy('quiz_timeout_resume') = 1
     OR dblink_is_busy('quiz_score_repair') = 1 LOOP
    v_tries := v_tries + 1;
    IF v_tries > 750 THEN
      RAISE EXCEPTION 'timeout/resume lock-order regression timed out';
    END IF;
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_repair text;
  v_resume jsonb;
BEGIN
  SELECT result.value INTO v_resume
  FROM dblink_get_result('quiz_timeout_resume') AS result(value jsonb);
  SELECT result.value INTO v_repair
  FROM dblink_get_result('quiz_score_repair') AS result(value text);

  IF v_resume->>'availability' <> 'pending_results' THEN
    RAISE EXCEPTION 'resume did not terminalize the timed-out attempt: %', v_resume;
  END IF;
  IF v_repair <> 'repaired' THEN
    RAISE EXCEPTION 'score repair did not complete after resume: %', v_repair;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.quiz_attempt_answers
    WHERE attempt_question_id = '75000000-0000-4000-8000-000000000007'
      AND answer_payload @> '{"timeout":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'resume did not persist the timeout answer';
  END IF;
END;
$$;

SELECT dblink_disconnect('quiz_timeout_blocker');
SELECT dblink_disconnect('quiz_timeout_resume');
SELECT dblink_disconnect('quiz_score_repair');

DROP FUNCTION public.try_quiz_score_repair_lock_order_v2(uuid);
SET session_replication_role = replica;
DELETE FROM public.quiz_attempt_answers WHERE attempt_question_id = '75000000-0000-4000-8000-000000000007';
DELETE FROM public.quiz_attempt_questions WHERE id = '75000000-0000-4000-8000-000000000007';
DELETE FROM public.quiz_attempts WHERE id = '75000000-0000-4000-8000-000000000006';
DELETE FROM public.quiz_question_variants WHERE id = '75000000-0000-4000-8000-000000000005';
DELETE FROM public.quiz_question_slots WHERE id = '75000000-0000-4000-8000-000000000004';
DELETE FROM public.quiz_events WHERE id = '75000000-0000-4000-8000-000000000003';
DELETE FROM public.customers WHERE id = '75000000-0000-4000-8000-000000000002';
DELETE FROM public.merchants WHERE id = '75000000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = '75000000-0000-4000-8000-000000000000';
SET session_replication_role = origin;
