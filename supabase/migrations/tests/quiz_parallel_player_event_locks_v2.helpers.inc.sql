-- Included by quiz_parallel_player_event_locks_v2.sql.
-- Helpers. A real signed route proof is built here so no production function
-- has to be stubbed in sessions that commit.
CREATE FUNCTION pg_temp.quiz_par_proof(p_action text, p_subject text, p_user uuid)
RETURNS jsonb LANGUAGE sql AS $$
  WITH base AS (
    SELECT 'quiz-rpc-proof:v1'::text AS version, 'quiz_phase1a'::text AS scope,
      pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at,
      pg_catalog.repeat('0', 64) AS payload_hash
  )
  SELECT pg_catalog.jsonb_build_object(
    'version', base.version, 'scope', base.scope, 'action', p_action,
    'subject_id', p_subject, 'user_id', p_user::text,
    'issued_at', base.issued_at, 'payload_hash', base.payload_hash,
    'proof_id', gen_random_uuid()::text,
    'signature', pg_catalog.encode(extensions.hmac(
      base.version || E'\n' || base.scope || E'\n' || p_action || E'\n'
        || p_subject || E'\n' || p_user::text || E'\n' || base.issued_at
        || E'\n' || base.payload_hash,
      'quiz-parallel-locks-test-secret-0123456789', 'sha256'), 'hex'))
  FROM base;
$$;

CREATE FUNCTION pg_temp.quiz_par_start_sql(p_user uuid, p_device text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_event constant uuid := '78000000-0000-4000-8000-000000000003';
  v_request uuid := gen_random_uuid();
BEGIN
  RETURN pg_catalog.format(
    'SELECT public.start_quiz_attempt_with_device_v2(%L::uuid, %L, %L, %L::jsonb, %L::jsonb, %L, true, %L::uuid, %L, %L, %L::uuid)',
    v_event, 'standard', p_device,
    pg_temp.quiz_par_proof('start_quiz_attempt_v2',
      v_event::text || ':' || v_request::text, p_user),
    pg_temp.quiz_par_proof('start_quiz_attempt_with_device_v2',
      public.quiz_device_proof_subject(v_event, p_device), p_user),
    'parallel-locks-v2', v_request, '1.0.0', 'android', p_user);
END;
$$;

CREATE FUNCTION pg_temp.quiz_par_answer_sql(p_user uuid, p_attempt uuid, p_question uuid, p_answer text)
RETURNS text LANGUAGE sql AS $$
  SELECT pg_catalog.format(
    'SELECT public.submit_quiz_answer_v2(%L::uuid, %L::uuid, %L, %L::jsonb, %L::uuid)',
    p_attempt, p_question, p_answer,
    pg_temp.quiz_par_proof('submit_quiz_answer_v2',
      p_attempt::text || ':' || p_question::text, p_user),
    p_user);
$$;

CREATE FUNCTION pg_temp.quiz_par_remote(p_connection text, p_sql text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT result.value FROM public.dblink(p_connection, p_sql) AS result(value jsonb);
$$;

CREATE TEMP TABLE quiz_par_player (
  player text PRIMARY KEY,
  user_id uuid NOT NULL,
  attempt_id uuid,
  question_id uuid
);
INSERT INTO quiz_par_player(player, user_id) VALUES
  ('a', '78000000-0000-4000-8000-00000000000a'),
  ('b', '78000000-0000-4000-8000-00000000000b');

CREATE FUNCTION pg_temp.quiz_par_record(p_player text, p_state jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_state->>'attemptId' IS NULL THEN
    RAISE EXCEPTION 'player % got no attempt state: %', p_player, p_state;
  END IF;
  UPDATE quiz_par_player
  SET attempt_id = (p_state->>'attemptId')::uuid,
      question_id = NULLIF(p_state->'question'->>'id', '')::uuid
  WHERE player = p_player;
END;
$$;

SELECT public.dblink_exec('quiz_par_a', $$SET request.jwt.claim.sub = '78000000-0000-4000-8000-00000000000a'$$);
SELECT public.dblink_exec('quiz_par_b', $$SET request.jwt.claim.sub = '78000000-0000-4000-8000-00000000000b'$$);
SELECT public.dblink_exec('quiz_par_a', $$SET app.quiz_rpc_server_secret_current = 'quiz-parallel-locks-test-secret-0123456789'$$);
SELECT public.dblink_exec('quiz_par_b', $$SET app.quiz_rpc_server_secret_current = 'quiz-parallel-locks-test-secret-0123456789'$$);
SELECT public.dblink_exec('quiz_par_a', $$SET statement_timeout = '30s'$$);
SELECT public.dblink_exec('quiz_par_b', $$SET statement_timeout = '30s'$$);
-- If B ever has to wait for A, this turns the wait into a failure (55P03).
SELECT public.dblink_exec('quiz_par_b', $$SET lock_timeout = '3s'$$);
