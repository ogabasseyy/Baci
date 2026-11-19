-- Regression coverage for 20261115120000_quiz_app_attestation_challenges.sql.
-- Usage: psql -v ON_ERROR_STOP=1 $DATABASE_URL -f supabase/migrations/tests/quiz_app_attestation_challenges.sql

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.quiz_events(
  id, merchant_id, slug, title, status, starts_at, ends_at,
  live_window_seconds, compliance_verified,
  mode, contract_version, rules_version, attempts_terminalized_at,
  finalization_state, claim_window_seconds, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref, settings
) VALUES (
  '76000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000002',
  'attest-live', 'Attestation live', 'active',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, true,
  'live', 2, 'attest-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
), (
  '76000000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000002',
  'attest-draft', 'Attestation draft', 'draft',
  '2026-09-24T10:00:00+00', '2026-09-24T11:02:00+00', 3720, true,
  'live', 2, 'attest-v2', NULL,
  'pending', 60, 'free_skill_competition', 'Nigeria',
  'automated migration replay evidence',
  '{"prize_product_id": "66000000-0000-4000-8000-000000000000", "prize_product_name": "Prize Phone", "prize_name": "Quiz Prize"}'
);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('76000000-0000-4000-8000-000000000011',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000010'),
  ('76000000-0000-4000-8000-000000000013',
   '76000000-0000-4000-8000-000000000002',
   '76000000-0000-4000-8000-000000000012');

-- Catalog contract: RLS on, no table access for players, RPCs not callable
-- by anon/PUBLIC but callable by authenticated.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.quiz_app_attestation_challenges'::regclass) THEN
    RAISE EXCEPTION 'challenge table must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated',
       'public.quiz_app_attestation_challenges', 'SELECT')
    OR has_table_privilege('anon',
       'public.quiz_app_attestation_challenges', 'SELECT') THEN
    RAISE EXCEPTION 'players must not read the challenge table';
  END IF;
  IF has_function_privilege('anon',
       'public.issue_quiz_app_attestation_challenge_v1(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon',
       'public.consume_quiz_app_attestation_challenge_v1(uuid,text,text,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the attestation RPCs';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.issue_quiz_app_attestation_challenge_v1(uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated',
       'public.consume_quiz_app_attestation_challenge_v1(uuid,text,text,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute the attestation RPCs';
  END IF;
END;
$$;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"76000000-0000-4000-8000-000000000010"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_event constant uuid := '76000000-0000-4000-8000-000000000001';
  v_nonce constant text := repeat('a', 64);
  v_token constant text := repeat('b', 64);
  v_ok boolean;
  v_expires timestamptz;
BEGIN
  v_expires := public.issue_quiz_app_attestation_challenge_v1(v_event, v_nonce);
  IF v_expires <= now() OR v_expires > now() + interval '3 minutes' THEN
    RAISE EXCEPTION 'challenge must expire within about 2 minutes';
  END IF;

  -- A token minted BEFORE the challenge cannot satisfy it.
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    v_event, v_nonce, v_token, now() - interval '1 hour');
  IF v_ok THEN RAISE EXCEPTION 'stale token consumed a fresh challenge'; END IF;

  -- Wrong event is refused.
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    '76000000-0000-4000-8000-000000000003', v_nonce, v_token, now());
  IF v_ok THEN RAISE EXCEPTION 'challenge consumed for the wrong event'; END IF;

  -- Unknown nonce is refused.
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    v_event, repeat('c', 64), v_token, now());
  IF v_ok THEN RAISE EXCEPTION 'unknown nonce consumed'; END IF;

  -- Valid consume succeeds exactly once.
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    v_event, v_nonce, v_token, now());
  IF NOT v_ok THEN RAISE EXCEPTION 'valid challenge was not consumed'; END IF;
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    v_event, v_nonce, v_token, now());
  IF v_ok THEN RAISE EXCEPTION 'challenge was consumed twice (replay)'; END IF;

  -- The same token cannot satisfy a second, fresh challenge.
  PERFORM public.issue_quiz_app_attestation_challenge_v1(v_event, repeat('d', 64));
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    v_event, repeat('d', 64), v_token, now());
  IF v_ok THEN RAISE EXCEPTION 'token replayed against a new challenge'; END IF;

  -- Events the caller may not see cannot get a challenge.
  BEGIN
    PERFORM public.issue_quiz_app_attestation_challenge_v1(
      '76000000-0000-4000-8000-000000000003', repeat('e', 64));
    RAISE EXCEPTION 'challenge issued for an unavailable event';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  -- Open challenges are capped per user.
  FOR i IN 1..10 LOOP
    BEGIN
      PERFORM public.issue_quiz_app_attestation_challenge_v1(
        v_event, lpad(to_hex(i), 64, '1'));
    EXCEPTION WHEN SQLSTATE '54000' THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.issue_quiz_app_attestation_challenge_v1(
      v_event, repeat('f', 64));
    RAISE EXCEPTION 'open challenge cap not enforced';
  EXCEPTION WHEN SQLSTATE '54000' THEN NULL;
  END;
END;
$$;

-- Another player cannot consume someone else's challenge.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"76000000-0000-4000-8000-000000000012"}',
  true
);
DO $$
DECLARE v_ok boolean;
BEGIN
  v_ok := public.consume_quiz_app_attestation_challenge_v1(
    '76000000-0000-4000-8000-000000000001', repeat('d', 64),
    repeat('9', 64), now());
  IF v_ok THEN
    RAISE EXCEPTION 'another player consumed a challenge they do not own';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL session_replication_role = origin;

ROLLBACK;
