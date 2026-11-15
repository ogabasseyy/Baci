-- REGRESSION TEST: live prize quiz starts are refused for under-18 players
-- inside the database function (QZ014), not only by the web route.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('76000000-0000-4000-8000-000000000000',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'quiz-age-gate@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES ('76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000000',
  'quiz-age-gate-merchant@example.com', 'Quiz age gate test', 'quiz-age-gate-test');

INSERT INTO public.customers (id, merchant_id, user_id, email, username)
VALUES ('76000000-0000-4000-8000-000000000002',
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000000',
  'quiz-age-gate@example.com', 'agegatetester');

INSERT INTO public.quiz_events (id, merchant_id, slug, title, status, starts_at,
  ends_at, mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone)
VALUES ('76000000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000001', 'quiz-age-gate', 'Quiz age gate',
  'active', now() - interval '1 minute', now() + interval '5 minutes',
  'live', 2, 'age-gate-v2', 1, 5, 5, 360, 1, 'Africa/Lagos');

CREATE FUNCTION pg_temp.start_state(p_dob date) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.customers SET date_of_birth = p_dob
  WHERE id = '76000000-0000-4000-8000-000000000002';
  PERFORM private.start_quiz_attempt_v2_core(
    '76000000-0000-4000-8000-000000000003'::uuid, 'standard', 'age-gate-v2', true,
    gen_random_uuid(), '1.0.0', 'web', '{}'::jsonb,
    '76000000-0000-4000-8000-000000000000'::uuid, true);
  RETURN 'started';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF pg_temp.start_state(NULL) <> 'QZ013' THEN
    RAISE EXCEPTION 'missing date of birth must raise QZ013, got %', pg_temp.start_state(NULL);
  END IF;
  IF pg_temp.start_state((v_today - interval '17 years')::date) <> 'QZ014' THEN
    RAISE EXCEPTION 'age 17 must raise QZ014';
  END IF;
  IF pg_temp.start_state((v_today - interval '18 years' + interval '1 day')::date) <> 'QZ014' THEN
    RAISE EXCEPTION 'day before 18th birthday must raise QZ014';
  END IF;
  IF pg_temp.start_state((v_today - interval '18 years')::date) = 'QZ014' THEN
    RAISE EXCEPTION 'exactly 18 today must NOT be age restricted';
  END IF;
  IF pg_temp.start_state((v_today - interval '40 years')::date) = 'QZ014' THEN
    RAISE EXCEPTION 'adult must NOT be age restricted';
  END IF;
END;
$$;
ROLLBACK;
