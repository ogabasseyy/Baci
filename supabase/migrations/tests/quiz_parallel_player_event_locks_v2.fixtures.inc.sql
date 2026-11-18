-- Included by quiz_parallel_player_event_locks_v2.sql.
-- Fixture rows are committed because the other sessions must see them.
-- Foreign-key cascades do not run in replica mode, so children go first.
CREATE FUNCTION pg_temp.quiz_par_cleanup() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_event constant uuid := '78000000-0000-4000-8000-000000000003';
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.quiz_attempt_answers WHERE attempt_question_id IN (
    SELECT question.id FROM public.quiz_attempt_questions AS question
    JOIN public.quiz_attempts AS attempt ON attempt.id = question.attempt_id
    WHERE attempt.event_id = v_event);
  DELETE FROM public.quiz_attempt_questions WHERE attempt_id IN (
    SELECT id FROM public.quiz_attempts WHERE event_id = v_event);
  DELETE FROM public.quiz_attempt_devices WHERE event_id = v_event;
  DELETE FROM public.quiz_live_standings_v2 WHERE event_id = v_event;
  DELETE FROM public.quiz_attempts WHERE event_id = v_event;
  DELETE FROM public.quiz_question_variants WHERE slot_id IN (
    SELECT id FROM public.quiz_question_slots WHERE event_id = v_event);
  DELETE FROM public.quiz_question_slots WHERE event_id = v_event;
  DELETE FROM public.quiz_event_testers WHERE event_id = v_event;
  DELETE FROM public.quiz_events WHERE id = v_event;
  DELETE FROM public.customers WHERE id IN (
    '78000000-0000-4000-8000-000000000011', '78000000-0000-4000-8000-000000000012');
  DELETE FROM public.merchants WHERE id = '78000000-0000-4000-8000-000000000001';
  DELETE FROM auth.users WHERE id IN (
    '78000000-0000-4000-8000-000000000000',
    '78000000-0000-4000-8000-00000000000a',
    '78000000-0000-4000-8000-00000000000b');
  SET LOCAL session_replication_role = origin;
END;
$$;

SELECT pg_temp.quiz_par_cleanup();

SET session_replication_role = replica;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT fixture.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', fixture.email, 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
FROM (VALUES
  ('78000000-0000-4000-8000-000000000000'::uuid, 'quiz-parallel-owner@example.com'),
  ('78000000-0000-4000-8000-00000000000a'::uuid, 'quiz-parallel-a@example.com'),
  ('78000000-0000-4000-8000-00000000000b'::uuid, 'quiz-parallel-b@example.com')
) AS fixture(id, email);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES ('78000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000000',
  'quiz-parallel-merchant@example.com', 'Quiz parallel test', 'quiz-parallel-test');

INSERT INTO public.customers (id, merchant_id, user_id, email, username, date_of_birth)
VALUES
  ('78000000-0000-4000-8000-000000000011', '78000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-00000000000a', 'quiz-parallel-a@example.com',
   'parallelplayera', DATE '1990-01-01'),
  ('78000000-0000-4000-8000-000000000012', '78000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-00000000000b', 'quiz-parallel-b@example.com',
   'parallelplayerb', DATE '1990-01-01');

-- Two questions, 10 seconds each, so a player holds a live question while the
-- other player works.
INSERT INTO public.quiz_events (id, merchant_id, slug, title, status, starts_at,
  ends_at, mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone)
VALUES ('78000000-0000-4000-8000-000000000003',
  '78000000-0000-4000-8000-000000000001', 'quiz-parallel-locks',
  'Quiz parallel locks', 'active', now() - interval '1 minute',
  now() + interval '5 minutes', 'test', 2, 'parallel-locks-v2', 2, 10, 20, 360,
  1, 'Africa/Lagos');

INSERT INTO public.quiz_event_testers (event_id, merchant_id, user_id) VALUES
  ('78000000-0000-4000-8000-000000000003', '78000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-00000000000a'),
  ('78000000-0000-4000-8000-000000000003', '78000000-0000-4000-8000-000000000001',
   '78000000-0000-4000-8000-00000000000b');

INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active) VALUES
  ('78000000-0000-4000-8000-000000000021', '78000000-0000-4000-8000-000000000003', 1, true),
  ('78000000-0000-4000-8000-000000000022', '78000000-0000-4000-8000-000000000003', 2, true);

-- Option "a" is the correct answer to both questions.
INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active) VALUES
  ('78000000-0000-4000-8000-000000000031', '78000000-0000-4000-8000-000000000021',
   'parallel-1', 'Parallel one?', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb,
   public.quiz_answer_key_hash('a'), true),
  ('78000000-0000-4000-8000-000000000032', '78000000-0000-4000-8000-000000000022',
   'parallel-2', 'Parallel two?', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb,
   public.quiz_answer_key_hash('a'), true);

SET session_replication_role = origin;
