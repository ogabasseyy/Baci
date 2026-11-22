-- Verifies `public.prepare_quiz_edge_rooms_v2` catalog security, privileges,
-- tenant isolation, room-count bounds, draft-only gating, empty-variant pool
-- rejection without backend_mode mutation, and authoritative payload shape.

\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- 1. Catalog & privilege assertions
-- ===========================================================================
DO $$
DECLARE
  v_sig constant text := 'public.prepare_quiz_edge_rooms_v2(uuid,uuid,integer,timestamp with time zone,timestamp with time zone,text,text,integer,integer,integer)';
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_sig::pg_catalog.regprocedure)
  INTO v_def;

  IF pg_catalog.strpos(v_def, 'SECURITY DEFINER') = 0
    OR pg_catalog.strpos(v_def, 'check_staff_permission') = 0
    OR pg_catalog.strpos(v_def, 'edge_rooms') = 0
    OR pg_catalog.strpos(v_def, 'expected_room_count') = 0
  THEN
    RAISE EXCEPTION 'prepare_quiz_edge_rooms_v2 missing expected security or edge room wiring';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_sig, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'prepare_quiz_edge_rooms_v2 EXECUTE privileges are misconfigured';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.reset_quiz_edge_rooms_draft_v2(uuid,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', 'public.reset_quiz_edge_rooms_draft_v2(uuid,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', 'public.reset_quiz_edge_rooms_draft_v2(uuid,uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'reset_quiz_edge_rooms_draft_v2 EXECUTE privileges are misconfigured';
  END IF;
END;
$$;

-- ===========================================================================
-- 2. Fixtures: two merchants, a draft event (initially incomplete pool),
--    and an already-active event
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  ('99000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge-prov-a@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('99000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge-prov-b@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.merchants (id, user_id, email, business_name, slug, payout_currency)
VALUES
  ('99000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000001', 'edge-prov-a@example.com', 'Edge Prov A', 'edge-prov-a', 'NGN'),
  ('99000000-0000-4000-8000-000000000102', '99000000-0000-4000-8000-000000000002', 'edge-prov-b@example.com', 'Edge Prov B', 'edge-prov-b', 'NGN');

INSERT INTO public.quiz_events (
  id, merchant_id, slug, title, status, starts_at, ends_at,
  mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone, backend_mode, settings
) VALUES
  (
    '99000000-0000-4000-8000-000000000401',
    '99000000-0000-4000-8000-000000000101',
    'edge-prov-draft', 'Edge Prov Draft', 'draft',
    NULL, NULL,
    'test', 2, 'test-v1', 2, 15, 30, 300, 3, 'Africa/Lagos',
    'postgres', '{}'::jsonb
  ),
  (
    '99000000-0000-4000-8000-000000000402',
    '99000000-0000-4000-8000-000000000101',
    'edge-prov-active', 'Edge Prov Active', 'active',
    '2026-11-22T10:00:00Z', '2026-11-22T10:10:00Z',
    'test', 2, 'test-v1', 1, 15, 15, 600, 3, 'Africa/Lagos',
    'postgres', '{}'::jsonb
  );

INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active) VALUES
  ('99000000-0000-4000-8000-000000000501', '99000000-0000-4000-8000-000000000401', 1, true),
  ('99000000-0000-4000-8000-000000000502', '99000000-0000-4000-8000-000000000401', 2, true),
  ('99000000-0000-4000-8000-000000000503', '99000000-0000-4000-8000-000000000402', 1, true);

-- Slot 501 has a valid hashed variant; slot 502 intentionally has none yet.
INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active) VALUES
  (
    '99000000-0000-4000-8000-000000000601',
    '99000000-0000-4000-8000-000000000501',
    'k1', 'What is 2+2?',
    '[{"id":"opt-a","label":"4"},{"id":"opt-b","label":"5"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '99000000-0000-4000-8000-000000000603',
    '99000000-0000-4000-8000-000000000503',
    'k3', 'Active Q1',
    '[{"id":"opt-a","label":"A"},{"id":"opt-b","label":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  );

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- 3. Behavioral assertions: auth, tenant isolation, bounds, status, pool, shape
-- ===========================================================================
DO $$
DECLARE
  v_user_a constant uuid := '99000000-0000-4000-8000-000000000001';
  v_user_b constant uuid := '99000000-0000-4000-8000-000000000002';
  v_merchant_a constant uuid := '99000000-0000-4000-8000-000000000101';
  v_draft_event constant uuid := '99000000-0000-4000-8000-000000000401';
  v_active_event constant uuid := '99000000-0000-4000-8000-000000000402';
  v_sqlstate text;
  v_backend_mode text;
  v_room_count integer;
  v_payload jsonb;
BEGIN
  -- 3a. Unauthenticated caller (auth.uid() IS NULL) -> 28000
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(
      v_draft_event, v_merchant_a, 4,
      '2026-11-22T10:00:00Z', '2026-11-22T10:05:00Z', 'active'
    );
    RAISE EXCEPTION 'expected 28000 for unauthenticated caller';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '28000' THEN
      RAISE EXCEPTION 'expected 28000 for unauthenticated caller, got %', v_sqlstate;
    END IF;
  END;

  -- 3b. Cross-merchant caller (user B targeting merchant A) -> 42501
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(
      v_draft_event, v_merchant_a, 4,
      '2026-11-22T10:00:00Z', '2026-11-22T10:05:00Z', 'active'
    );
    RAISE EXCEPTION 'expected 42501 for cross-merchant caller';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '42501' THEN
      RAISE EXCEPTION 'expected 42501 for cross-merchant caller, got %', v_sqlstate;
    END IF;
  END;

  -- Switch to authorized merchant A caller for remaining checks
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true
  );

  -- 3c. Out-of-range room counts (0 and 257) -> 22023
  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(
      v_draft_event, v_merchant_a, 0,
      '2026-11-22T10:00:00Z', '2026-11-22T10:05:00Z', 'active'
    );
    RAISE EXCEPTION 'expected 22023 for room count 0';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '22023' THEN
      RAISE EXCEPTION 'expected 22023 for room count 0, got %', v_sqlstate;
    END IF;
  END;

  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(
      v_draft_event, v_merchant_a, 257,
      '2026-11-22T10:00:00Z', '2026-11-22T10:05:00Z', 'active'
    );
    RAISE EXCEPTION 'expected 22023 for room count 257';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '22023' THEN
      RAISE EXCEPTION 'expected 22023 for room count 257, got %', v_sqlstate;
    END IF;
  END;

  -- 3d. Already-active event rejected with QZ061 (cannot re-provision live event)
  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(v_active_event, v_merchant_a, 4);
    RAISE EXCEPTION 'expected QZ061 for already-active event';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> 'QZ061' THEN
      RAISE EXCEPTION 'expected QZ061 for already-active event, got %', v_sqlstate;
    END IF;
  END;

  -- 3e. Slot with zero active hashed variants rejected with QZ003 and does NOT flip backend_mode
  BEGIN
    PERFORM public.prepare_quiz_edge_rooms_v2(
      v_draft_event, v_merchant_a, 4,
      '2026-11-22T10:00:00Z', '2026-11-22T10:05:00Z', 'active'
    );
    RAISE EXCEPTION 'expected QZ003 for incomplete question pool';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> 'QZ003' THEN
      RAISE EXCEPTION 'expected QZ003 for incomplete question pool, got %', v_sqlstate;
    END IF;
  END;

  SELECT backend_mode INTO v_backend_mode
  FROM public.quiz_events WHERE id = v_draft_event;
  IF v_backend_mode <> 'postgres' THEN
    RAISE EXCEPTION 'incomplete pool must not flip backend_mode, got %', v_backend_mode;
  END IF;

  -- 3f. Complete slot 2 and verify authorized merchant A succeeds with full payload
  INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active)
  VALUES (
    '99000000-0000-4000-8000-000000000602',
    '99000000-0000-4000-8000-000000000502',
    'k2', 'What is 3+3?',
    '[{"id":"opt-a","label":"6"},{"id":"opt-b","label":"7"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  );

  v_payload := public.prepare_quiz_edge_rooms_v2(
    v_draft_event,
    v_merchant_a,
    4,
    '2026-11-22T10:00:00Z',
    '2026-11-22T10:05:00Z',
    'active',
    'test-v1',
    2,
    15,
    3
  );

  SELECT backend_mode, expected_room_count
  INTO v_backend_mode, v_room_count
  FROM public.quiz_events WHERE id = v_draft_event;

  IF v_backend_mode <> 'edge_rooms' OR v_room_count <> 4 THEN
    RAISE EXCEPTION 'expected backend_mode=edge_rooms and expected_room_count=4, got % / %', v_backend_mode, v_room_count;
  END IF;

  IF pg_catalog.jsonb_array_length(v_payload->'roomIds') <> 4
    OR (v_payload->'config'->>'status') <> 'active'
    OR pg_catalog.jsonb_array_length(v_payload->'config'->'slots') <> 2
    OR (v_payload->'config'->'slots'->0->'variants'->0->>'answerKeyHash') <> public.quiz_answer_key_hash('opt-a')
    OR (v_payload->'config'->'slots'->1->'variants'->0->>'answerKeyHash') <> public.quiz_answer_key_hash('opt-a')
  THEN
    RAISE EXCEPTION 'prepare_quiz_edge_rooms_v2 returned unexpected payload: %', v_payload;
  END IF;

  -- 3g. Verify companion reset RPC reverts a draft back to postgres cleanly
  PERFORM public.reset_quiz_edge_rooms_draft_v2(v_draft_event, v_merchant_a);
  SELECT backend_mode, expected_room_count
  INTO v_backend_mode, v_room_count
  FROM public.quiz_events WHERE id = v_draft_event;
  IF v_backend_mode <> 'postgres' OR v_room_count IS NOT NULL THEN
    RAISE EXCEPTION 'reset_quiz_edge_rooms_draft_v2 failed to revert draft, got % / %', v_backend_mode, v_room_count;
  END IF;
END;
$$;

ROLLBACK;
