-- Regression coverage for 20260924090000_quiz_start_guard_context_v2.sql.
-- Usage: psql $DATABASE_URL -f supabase/migrations/tests/quiz_start_guard_context_v2.sql

BEGIN;

SET LOCAL session_replication_role = replica;
-- Every v2 fixture satisfies the table CHECKs (runtime window/counts,
-- regulatory triple) so the inserts run; visibility differences below
-- come only from the projection's own predicates. Fixed stamps keep the
-- 3720-second live window exact instead of clock-relative.
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified,
  mode, contract_version, rules_version, attempts_terminalized_at,
  finalization_state, claim_window_seconds, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref, settings
) VALUES (
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-approved-live', 'Start guard approved live', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, true,
  'live', 2, 'guard-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
), (
  '75000000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-malformed-live', 'Start guard malformed live', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, true,
  'live', 2, 'guard-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{}'
), (
  '75000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-private-test', 'Start guard private test', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, false,
  'test', 2, 'guard-v2', NULL,
  'pending', 60, NULL, NULL, NULL,
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
), (
  '75000000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-draft-live', 'Start guard draft live', 'draft',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, true,
  'live', 2, 'guard-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
), (
  '75000000-0000-4000-8000-000000000006',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-v1-live', 'Start guard v1 live', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 60, true,
  'live', 1, 'guard-v1', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{}'
), (
  '75000000-0000-4000-8000-000000000007',
  '75000000-0000-4000-8000-000000000002',
  'start-guard-service-test', 'Start guard service test', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, false,
  'test', 2, 'guard-v2', NULL,
  'pending', 60, NULL, NULL, NULL,
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  (
    '75000000-0000-4000-8000-000000000011',
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000010'
  ),
  (
    '75000000-0000-4000-8000-000000000013',
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000012'
  ),
  (
    '75000000-0000-4000-8000-000000000015',
    '75000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000014'
  );
INSERT INTO public.quiz_event_testers(event_id, merchant_id, user_id) VALUES (
  '75000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000010'
);
INSERT INTO public.quiz_event_testers(
  event_id, merchant_id, user_id, revoked_at
) VALUES (
  '75000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000014',
  pg_catalog.clock_timestamp()
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000010"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_context jsonb;
BEGIN
  -- Entitled customer + tester sees the approved live event.
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000001'
  );
  IF (v_context ->> 'found')::boolean IS NOT TRUE
    OR (v_context ->> 'mode') IS DISTINCT FROM 'live'
    OR (v_context ->> 'merchant_id')
      IS DISTINCT FROM '75000000-0000-4000-8000-000000000002'
    OR NOT COALESCE((v_context ->> 'prize_approved')::boolean, false)
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

  -- Structurally malformed live events (missing prize settings here)
  -- are indistinguishable from missing ones even for entitled callers.
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000003'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'malformed live event leaked its context';
  END IF;

  -- Testers see their private test event.
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000004'
  );
  IF (v_context ->> 'found')::boolean IS NOT TRUE
    OR (v_context ->> 'mode') IS DISTINCT FROM 'test'
  THEN
    RAISE EXCEPTION 'test event did not resolve its mode';
  END IF;

  -- Draft, v1, and missing events stay hidden.
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000005'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'draft event leaked its context';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000006'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'v1 event leaked its context';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000009'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'missing event did not report found=false';
  END IF;
END;
$$;

-- Customer without a tester row: live visible, private test hidden.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000012"}',
  true
);
DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000001'
  );
  IF (v_context ->> 'found')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'customer without tester row lost live visibility';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000004'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'private test leaked to a non-tester';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000007'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'untestered test event leaked to a non-tester';
  END IF;
END;
$$;

-- Revoked tester and non-customer stay hidden.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000014"}',
  true
);
DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000004'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'private test leaked to a revoked tester';
  END IF;
END;
$$;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"75000000-0000-4000-8000-000000000016"}',
  true
);
DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000001'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'live event leaked to a non-customer';
  END IF;
END;
$$;

-- service_role bypasses caller checks but stays scoped to list-visible
-- rows; test events read prize_approved boolean false.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000001'
  );
  IF (v_context ->> 'found')::boolean IS NOT TRUE
    OR NOT COALESCE((v_context ->> 'prize_approved')::boolean, false)
  THEN
    RAISE EXCEPTION 'service_role lost the approved live event';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000007'
  );
  IF (v_context ->> 'found')::boolean IS NOT TRUE
    OR (v_context ->> 'mode') IS DISTINCT FROM 'test'
    OR COALESCE((v_context ->> 'prize_approved')::boolean, true)
  THEN
    RAISE EXCEPTION 'service_role test read did not resolve boolean false';
  END IF;
  v_context := public.get_quiz_start_guard_context_v2(
    '75000000-0000-4000-8000-000000000003'
  );
  IF (v_context ->> 'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'malformed live event leaked to service_role';
  END IF;
  IF v_context ? 'regulatory_basis'
    OR v_context ? 'regulatory_jurisdiction'
    OR v_context ? 'regulatory_evidence_ref'
    OR v_context ? 'compliance_verified'
  THEN
    RAISE EXCEPTION 'guard context exposed compliance evidence';
  END IF;
END;
$$;

-- The service_role block above cannot restore replication mode itself;
-- drop back to the invoking role first (ROLLBACK would also restore it).
RESET ROLE;
SET LOCAL session_replication_role = origin;

ROLLBACK;
