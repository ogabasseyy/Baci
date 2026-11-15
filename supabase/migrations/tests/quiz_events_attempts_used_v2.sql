-- Coverage for 20261115120000_quiz_events_attempts_used_v2.sql.
-- Usage: psql $DATABASE_URL -f supabase/migrations/tests/quiz_events_attempts_used_v2.sql

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified, mode, contract_version,
  rules_version, finalization_state, claim_window_seconds, max_attempts, settings
) VALUES (
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000002',
  'attempts-used-test', 'Attempts used test', 'active',
  '2026-11-15T10:00:00+00', '2026-11-15T11:02:00+00', 3720, false,
  'test', 2, 'attempts-v2', 'pending', 60, 3,
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('76000000-0000-4000-8000-000000000011',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000010'),
  ('76000000-0000-4000-8000-000000000013',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000012');
INSERT INTO public.quiz_event_testers(event_id, merchant_id, user_id) VALUES
  ('76000000-0000-4000-8000-000000000001',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000010'),
  ('76000000-0000-4000-8000-000000000001',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000012');
-- Customer 1: one submitted, one started and one test_reset attempt.
-- Customer 2: no attempts.
INSERT INTO public.quiz_attempts(
  id, event_id, customer_id, status, attempt_number, score,
  leaderboard_username, rules_version, terms_accepted_at, app_version, platform
) VALUES
  ('76000000-0000-4000-8000-000000000021',
   '76000000-0000-4000-8000-000000000001',
   '76000000-0000-4000-8000-000000000011',
   'submitted', 1, 1, 'triesproof', 'attempts-v2',
   pg_catalog.clock_timestamp(), 'migration-test', 'web'),
  ('76000000-0000-4000-8000-000000000022',
   '76000000-0000-4000-8000-000000000001',
   '76000000-0000-4000-8000-000000000011',
   'started', 2, 0, 'triesproof', 'attempts-v2',
   pg_catalog.clock_timestamp(), 'migration-test', 'web'),
  ('76000000-0000-4000-8000-000000000023',
   '76000000-0000-4000-8000-000000000001',
   '76000000-0000-4000-8000-000000000011',
   'test_reset', 3, 0, 'triesproof', 'attempts-v2',
   pg_catalog.clock_timestamp(), 'migration-test', 'web');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"76000000-0000-4000-8000-000000000010"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_event jsonb;
BEGIN
  SELECT item INTO v_event
  FROM pg_catalog.jsonb_array_elements(
    public.list_quiz_events_v2('76000000-0000-4000-8000-000000000002', 20, 0)
      -> 'events'
  ) AS item
  WHERE item ->> 'id' = '76000000-0000-4000-8000-000000000001';
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'tester did not see the test event';
  END IF;
  -- Same predicate as the start guard: test_reset is not counted.
  IF (v_event ->> 'attemptsUsed')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'attemptsUsed must count non-test_reset attempts, got %',
      v_event ->> 'attemptsUsed';
  END IF;
  IF (v_event ->> 'maxAttempts')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'maxAttempts changed unexpectedly';
  END IF;
END;
$$;

-- A customer with no attempts gets 0, not another customer's count.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"76000000-0000-4000-8000-000000000012"}',
  true
);
DO $$
DECLARE
  v_event jsonb;
BEGIN
  SELECT item INTO v_event
  FROM pg_catalog.jsonb_array_elements(
    public.list_quiz_events_v2('76000000-0000-4000-8000-000000000002', 20, 0)
      -> 'events'
  ) AS item
  WHERE item ->> 'id' = '76000000-0000-4000-8000-000000000001';
  IF (v_event ->> 'attemptsUsed')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'customer without attempts must see attemptsUsed 0';
  END IF;
END;
$$;

-- Non-customers and signed-out callers are still rejected.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"76000000-0000-4000-8000-000000000099"}',
  true
);
DO $$
BEGIN
  PERFORM public.list_quiz_events_v2(
    '76000000-0000-4000-8000-000000000002', 20, 0
  );
  RAISE EXCEPTION 'non-customer must not list events';
EXCEPTION
  WHEN SQLSTATE 'QZ031' THEN NULL;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon', 'public.list_quiz_events_v2(uuid,integer,integer)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.list_quiz_events_v2(uuid,integer,integer)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'list_quiz_events_v2 grants changed';
  END IF;
END;
$$;

ROLLBACK;
