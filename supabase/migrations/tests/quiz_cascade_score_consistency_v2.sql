BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.customers(id, merchant_id, email, username)
VALUES (
  '78000000-0000-4000-8000-000000000004',
  '78000000-0000-4000-8000-000000000002',
  'cascade-score-proof@example.test', 'cascadeproof'
);
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone
) VALUES (
  '78000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000002',
  'cascade-score-proof', 'Cascade score proof', 'active',
  pg_catalog.transaction_timestamp() - interval '1 minute',
  pg_catalog.transaction_timestamp() + interval '5 minutes',
  'test', 2, 'instant-v2', 1, 5, 5, 360, 1, 'Africa/Lagos'
);
INSERT INTO public.quiz_attempts(
  id, event_id, customer_id, status, attempt_number, score,
  leaderboard_username, rules_version, terms_accepted_at,
  app_version, platform
) VALUES (
  '78000000-0000-4000-8000-000000000003',
  '78000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000004',
  'disqualified', 1, 1, 'cascadeproof', 'instant-v2',
  pg_catalog.clock_timestamp(), 'migration-test', 'web'
);
INSERT INTO public.quiz_attempt_questions(
  id, attempt_id, slot_id, variant_id, position
) VALUES (
  '78000000-0000-4000-8000-000000000005',
  '78000000-0000-4000-8000-000000000003',
  '78000000-0000-4000-8000-000000000006',
  '78000000-0000-4000-8000-000000000007', 1
);
INSERT INTO public.quiz_attempt_answers(
  id, attempt_question_id, score_delta
) VALUES (
  '78000000-0000-4000-8000-000000000008',
  '78000000-0000-4000-8000-000000000005', 1
);
SET LOCAL session_replication_role = origin;

DELETE FROM public.quiz_attempt_questions
WHERE id = '78000000-0000-4000-8000-000000000005';

DO $$
DECLARE
  v_answer_count integer;
  v_score integer;
BEGIN
  SELECT score INTO v_score
  FROM public.quiz_attempts
  WHERE id = '78000000-0000-4000-8000-000000000003';
  IF v_score <> 0 THEN
    RAISE EXCEPTION 'cascaded answer deletion left stale score: %', v_score;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_answer_count
  FROM public.quiz_attempt_answers
  WHERE id = '78000000-0000-4000-8000-000000000008';
  IF v_answer_count <> 0 THEN
    RAISE EXCEPTION 'question deletion did not cascade to its answer';
  END IF;
END;
$$;

ROLLBACK;
