BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.merchants(
  id, user_id, email, business_name, slug
) VALUES (
  '79000000-0000-4000-8000-000000000002',
  '79000000-0000-4000-8000-000000000003',
  'score-repair-quiescence-proof@example.com',
  'Score repair quiescence proof', 'score-repair-quiescence-proof'
);
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  mode, contract_version, rules_version, live_window_seconds
) VALUES (
  '79000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000002',
  'score-repair-quiescence-proof', 'Score repair quiescence proof', 'active',
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp() + interval '1 minute',
  'test', 2, 'instant-v2', 120
);
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
  PERFORM private.assert_quiz_score_repair_quiescent_v2();
  RAISE EXCEPTION 'score repair guard allowed an active v2 event';
EXCEPTION
  WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'quiz_score_repair_requires_quiescent_v2_events' THEN
      RAISE;
    END IF;
END;
$$;

UPDATE public.quiz_events
SET ends_at = starts_at + interval '30 seconds',
    live_window_seconds = 30
WHERE id = '79000000-0000-4000-8000-000000000001';

SELECT private.assert_quiz_score_repair_quiescent_v2();

ROLLBACK;
