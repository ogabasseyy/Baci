-- Regression coverage for 20260924090000_quiz_start_guard_context_v2.sql.
-- Usage: psql $DATABASE_URL -f supabase/migrations/tests/quiz_start_guard_context_v2.sql

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified,
  mode, contract_version, rules_version, attempts_terminalized_at,
  finalization_state, claim_window_seconds, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref
) VALUES (
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-approved-live', 'Start guard approved live', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() + interval '1 hour', 60, true,
  'live', 2, 'guard-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence'
), (
  '75000000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-unverified-live', 'Start guard unverified live', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() + interval '1 hour', 60, false,
  'live', 2, 'guard-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence'
), (
  '75000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-private-test', 'Start guard private test', 'active',
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() + interval '1 hour', 60, false,
  'test', 2, 'guard-v2', NULL,
  'pending', 60, NULL, NULL, NULL
);

DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000001'
  );
  IF COALESCE((v_context ->> 'found')::boolean, false) IS NOT TRUE
    OR (v_context ->> 'mode') <> 'live'
    OR (v_context ->> 'merchant_id') <> '75000000-0000-4000-8000-000000000002'
    OR COALESCE((v_context ->> 'prize_approved')::boolean, false) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'approved live event did not return a positive verdict';
  END IF;
  IF v_context ? 'regulatory_basis'
    OR v_context ? 'regulatory_jurisdiction'
    OR v_context ? 'regulatory_evidence_ref'
    OR v_context ? 'compliance_verified'
  THEN
    RAISE EXCEPTION 'guard context exposed compliance evidence';
  END IF;

  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000003'
  );
  IF COALESCE((v_context ->> 'prize_approved')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'unverified live event returned a positive verdict';
  END IF;

  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000004'
  );
  IF COALESCE((v_context ->> 'found')::boolean, false) IS NOT TRUE
    OR (v_context ->> 'mode') <> 'test'
  THEN
    RAISE EXCEPTION 'test event did not resolve its mode';
  END IF;

  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000009'
  );
  IF COALESCE((v_context ->> 'found')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'missing event did not report found=false';
  END IF;
END;
$$;

SET LOCAL session_replication_role = origin;

ROLLBACK;
