BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.merchants(id, email, business_name, slug)
VALUES (
  '79000000-0000-4000-8000-000000000002',
  'live-score-gate@example.test',
  'Live score gate proof', 'live-score-gate-proof'
);
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone, compliance_verified, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref
) VALUES (
  '79000000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000002',
  'live-score-gate-proof', 'Live score gate proof', 'active',
  pg_catalog.transaction_timestamp() - interval '2 minutes',
  pg_catalog.transaction_timestamp() - interval '1 minute',
  'live', 2, 'instant-v2', 1, 5, 5, 60, 1, 'Africa/Lagos', true,
  'free_skill_competition', 'Nigeria', 'automated migration replay evidence'
);
SET LOCAL session_replication_role = origin;

UPDATE public.quiz_runtime_control_v2
SET production_phase = true,
    production_approved = true,
    updated_at = pg_catalog.clock_timestamp()
WHERE singleton;

UPDATE private.quiz_test_publication_control_v2
SET score_repair_ready = false
WHERE singleton;

DO $$
BEGIN
  BEGIN
    UPDATE public.quiz_events
    SET results_published_at = pg_catalog.clock_timestamp()
    WHERE id = '79000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'closed score gate allowed live publication';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'quiz_live_score_publication_not_ready' THEN
      RAISE;
    END IF;
  END;
END;
$$;

UPDATE private.quiz_test_publication_control_v2
SET score_repair_ready = true
WHERE singleton;

UPDATE public.quiz_events
SET results_published_at = pg_catalog.clock_timestamp()
WHERE id = '79000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.quiz_events
    WHERE id = '79000000-0000-4000-8000-000000000001'
      AND results_published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ready score gate blocked live publication';
  END IF;
END;
$$;

ROLLBACK;
