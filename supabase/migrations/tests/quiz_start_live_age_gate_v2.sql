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
  max_attempts, time_zone, compliance_verified, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref)
VALUES ('76000000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000001', 'quiz-age-gate', 'Quiz age gate',
  'active', now() - interval '1 minute', now() + interval '5 minutes',
  'live', 2, 'age-gate-v2', 1, 5, 5, 360, 1, 'Africa/Lagos', true,
  'free_skill_competition', 'NG', 'test-fixture-evidence-ref');

-- A second, test-mode event (under-18 must still be allowed there) plus one
-- question each so a passing age gate really reaches 'started'.
INSERT INTO public.quiz_events (id, merchant_id, slug, title, status, starts_at,
  ends_at, mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone)
VALUES ('76000000-0000-4000-8000-000000000010',
  '76000000-0000-4000-8000-000000000001', 'quiz-age-gate-test', 'Quiz age gate test mode',
  'active', now() - interval '1 minute', now() + interval '5 minutes',
  'test', 2, 'age-gate-v2', 1, 5, 5, 360, 1, 'Africa/Lagos');
INSERT INTO public.quiz_event_testers (event_id, merchant_id, user_id)
VALUES ('76000000-0000-4000-8000-000000000010',
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000000');
INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active) VALUES
  ('76000000-0000-4000-8000-000000000004', '76000000-0000-4000-8000-000000000003', 1, true),
  ('76000000-0000-4000-8000-000000000014', '76000000-0000-4000-8000-000000000010', 1, true);
INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active) VALUES
  ('76000000-0000-4000-8000-000000000005', '76000000-0000-4000-8000-000000000004', 'age-gate', 'Age gate?',
   '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb, repeat('a', 64), true),
  ('76000000-0000-4000-8000-000000000015', '76000000-0000-4000-8000-000000000014', 'age-gate-t', 'Age gate test?',
   '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb, repeat('a', 64), true);

-- Fixtures are in; run the function under normal trigger semantics.
SET LOCAL session_replication_role = origin;

-- Authenticate as the fixture player (auth.uid() must equal p_user_id).
SELECT set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000000', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000000","role":"authenticated"}', true);

-- The HMAC route proof is covered by quiz_phase1a_foundation.sql. Here it is
-- stubbed to true so the test reaches the age gate. This DDL is rolled back
-- with the transaction below.
CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid(
  p_route_proof jsonb,
  p_expected_action text DEFAULT NULL,
  p_expected_subject_id text DEFAULT NULL,
  p_expected_user_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql AS 'SELECT true';

CREATE FUNCTION pg_temp.start_state(
  p_event uuid DEFAULT '76000000-0000-4000-8000-000000000003'::uuid
) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM private.start_quiz_attempt_v2_core(
    p_event, 'standard', 'age-gate-v2', true,
    gen_random_uuid(), '1.0.0', 'web', '{}'::jsonb,
    '76000000-0000-4000-8000-000000000000'::uuid, true);
  RETURN 'started';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

-- Each failed expectation raises a unique SQLSTATE: "T<n>" plus the last three
-- characters of the real state, so a replay log (which only prints the
-- SQLSTATE) says which check failed and why.
CREATE FUNCTION pg_temp.expect(p_n integer, p_expected text, p_actual text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'check %: expected %, got %', p_n, p_expected, p_actual
      USING ERRCODE = 'T' || p_n::text
        || CASE WHEN p_actual = 'started' THEN 'STA'
                ELSE pg_catalog.right(COALESCE(p_actual, '000'), 3) END;
  END IF;
END;
$$;

-- Fixture DOB edits use plain top-level SET LOCAL (as the sibling suites do);
-- every start below runs under normal (origin) trigger semantics.
SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = NULL
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(1, 'QZ013', pg_temp.start_state());

SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '17 years')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(2, 'QZ014', pg_temp.start_state());

SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '18 years' + interval '1 day')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(3, 'QZ014', pg_temp.start_state());

SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '18 years')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(4, 'started', pg_temp.start_state());

SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '40 years')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(5, 'started', pg_temp.start_state());

-- Gate must precede resume: with a started attempt present, an under-18 DOB
-- on the same live event is still refused.
SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '17 years')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(6, 'QZ014', pg_temp.start_state());

-- Test mode is unchanged: under-18 may still start.
SET LOCAL session_replication_role = replica;
UPDATE public.customers SET date_of_birth = (((now() AT TIME ZONE 'UTC')::date) - interval '17 years')::date
  WHERE id = '76000000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect(7, 'started', pg_temp.start_state('76000000-0000-4000-8000-000000000010'::uuid));

ROLLBACK;
