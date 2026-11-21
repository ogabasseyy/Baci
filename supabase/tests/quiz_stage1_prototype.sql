-- Stage 1 Edge Rooms prototype verification suite:
-- 1. Restricted worker role catalog & privilege isolation (zero table privs)
-- 2. Normalized-email expression index, admissions RLS & check_in_quiz_event_v2 gates
-- 3. Trigger isolation on edge_rooms vs full trigger retention on postgres
-- 4. Set-wise scoring parity (issued_at/received_at/persisted_close_at/tiebreak/block flags)
-- 5. Two-fact publication gate (withheld seal, halfway-interrupted scoring, cancellation, double-import)

\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- 1. Catalog & privilege assertions (never call-and-catch for role grants)
-- ===========================================================================
DO $$
DECLARE
  v_worker_table_privs integer;
  v_worker_funcs integer;
  v_other_funcs integer;
  v_public_acl_funcs integer;
  v_hook_proc regprocedure;
  v_hook_def text;
BEGIN
  -- Role posture: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'quiz_edge_batch_worker'
      AND NOT r.rolcanlogin
      AND NOT r.rolinherit
      AND NOT r.rolsuper
      AND NOT r.rolcreatedb
      AND NOT r.rolcreaterole
      AND NOT r.rolreplication
      AND NOT r.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker role posture invalid'
      USING ERRCODE = 'S1001';
  END IF;

  -- Zero direct table privileges across ALL public and private tables
  SELECT pg_catalog.count(*)::integer
  INTO v_worker_table_privs
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN pg_catalog.unnest(
    ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  ) AS priv(name)
  WHERE n.nspname IN ('public', 'private')
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND pg_catalog.has_table_privilege('quiz_edge_batch_worker', c.oid, priv.name);

  IF v_worker_table_privs <> 0 THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker holds % direct table privileges', v_worker_table_privs
      USING ERRCODE = 'S1002';
  END IF;

  -- Zero private schema USAGE
  IF pg_catalog.has_schema_privilege('quiz_edge_batch_worker', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker must not hold USAGE on private schema'
      USING ERRCODE = 'S1003';
  END IF;

  -- EXECUTE ONLY on the 4 narrow worker RPCs (and no other function in public/private)
  WITH allowed_worker_rpcs(sig) AS (
    VALUES
      ('public.ingest_quiz_edge_attempt_batch_v2(uuid,text,text,text,integer,integer,jsonb,integer,integer)'),
      ('public.record_quiz_edge_room_seal_v2(uuid,text,timestamp with time zone,text,integer,integer,text[],integer,text)'),
      ('public.get_quiz_edge_reconciliation_status_v2(uuid)'),
      ('public.score_quiz_edge_staged_batches_incremental_v2(uuid,integer)')
  )
  SELECT pg_catalog.count(*)::integer
  INTO v_worker_funcs
  FROM allowed_worker_rpcs AS a
  WHERE pg_catalog.has_function_privilege(
    'quiz_edge_batch_worker', a.sig::pg_catalog.regprocedure, 'EXECUTE'
  );

  IF v_worker_funcs <> 4 THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker missing EXECUTE on one or more allowed RPCs (got %)', v_worker_funcs
      USING ERRCODE = 'S1004';
  END IF;

  WITH allowed_worker_rpcs(sig) AS (
    VALUES
      ('public.ingest_quiz_edge_attempt_batch_v2(uuid,text,text,text,integer,integer,jsonb,integer,integer)'),
      ('public.record_quiz_edge_room_seal_v2(uuid,text,timestamp with time zone,text,integer,integer,text[],integer,text)'),
      ('public.get_quiz_edge_reconciliation_status_v2(uuid)'),
      ('public.score_quiz_edge_staged_batches_incremental_v2(uuid,integer)')
  )
  SELECT pg_catalog.count(*)::integer
  INTO v_other_funcs
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) AS acl
  WHERE n.nspname IN ('public', 'private')
    AND p.prokind IN ('f', 'p')
    AND acl.grantee = 'quiz_edge_batch_worker'::regrole
    AND p.oid NOT IN (SELECT sig::pg_catalog.regprocedure::oid FROM allowed_worker_rpcs);

  IF v_other_funcs <> 0 THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker holds direct ACL grants on % unexpected functions', v_other_funcs
      USING ERRCODE = 'S1005';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'private.score_quiz_edge_batches_core_v2(uuid,integer)',
      'private.score_and_materialize_edge_quiz_event_v2(uuid,uuid)',
      'private.backfill_quiz_edge_canonical_answers_v2(uuid,integer)',
      'private.quiz_edge_reconciliation_snapshot_v2(uuid)',
      'private.quiz_edge_event_ready_for_publication_v2(uuid)',
      'private.materialize_quiz_event_results_v2(uuid)',
      'private.terminalize_quiz_event_attempts_v2(uuid,timestamp with time zone)',
      'private.start_quiz_attempt_v2_core(uuid,text,text,boolean,uuid,text,text,jsonb,uuid,boolean)',
      'public.check_in_quiz_event_v2(uuid,text,text,boolean,uuid,text,text,text,text,text,timestamp with time zone,boolean)',
      'public.process_due_quiz_deadlines_v2(boolean,boolean)',
      'public.finalize_due_test_quiz_events_v2()',
      'public.terminalize_due_live_quiz_events_v2()',
      'public.finalize_due_live_quiz_events_v2(boolean,boolean)'
    ]) AS fn(sig)
    WHERE pg_catalog.has_function_privilege(
      'quiz_edge_batch_worker', fn.sig::pg_catalog.regprocedure, 'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'quiz_edge_batch_worker must not execute internal/scoring/deadline/check-in RPCs'
      USING ERRCODE = 'S1005';
  END IF;

  -- anon, authenticated, service_role, PUBLIC must NOT execute the 4 worker RPCs
  WITH allowed_worker_rpcs(sig) AS (
    VALUES
      ('public.ingest_quiz_edge_attempt_batch_v2(uuid,text,text,text,integer,integer,jsonb,integer,integer)'),
      ('public.record_quiz_edge_room_seal_v2(uuid,text,timestamp with time zone,text,integer,integer,text[],integer,text)'),
      ('public.get_quiz_edge_reconciliation_status_v2(uuid)'),
      ('public.score_quiz_edge_staged_batches_incremental_v2(uuid,integer)')
  )
  SELECT pg_catalog.count(*)::integer
  INTO v_public_acl_funcs
  FROM allowed_worker_rpcs AS a
  JOIN pg_catalog.pg_proc AS p ON p.oid = a.sig::pg_catalog.regprocedure
  WHERE pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     );

  IF v_public_acl_funcs <> 0 THEN
    RAISE EXCEPTION 'worker RPCs leaked EXECUTE to anon/authenticated/service_role/PUBLIC'
      USING ERRCODE = 'S1006';
  END IF;

  -- check_in_quiz_event_v2 callable by authenticated ONLY (not anon, not PUBLIC, not worker)
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.check_in_quiz_event_v2(uuid,text,text,boolean,uuid,text,text,text,text,text,timestamp with time zone,boolean)'::pg_catalog.regprocedure,
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.check_in_quiz_event_v2(uuid,text,text,boolean,uuid,text,text,text,text,text,timestamp with time zone,boolean)'::pg_catalog.regprocedure,
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'quiz_edge_batch_worker',
    'public.check_in_quiz_event_v2(uuid,text,text,boolean,uuid,text,text,text,text,text,timestamp with time zone,boolean)'::pg_catalog.regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'check_in_quiz_event_v2 grants mismatch'
      USING ERRCODE = 'S1007';
  END IF;

  -- Admissions RLS & column-level sensitivity guard
  IF NOT (
    SELECT relrowsecurity FROM pg_catalog.pg_class
    WHERE oid = 'public.quiz_event_admissions'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'quiz_event_admissions RLS must be enabled' USING ERRCODE = 'S1008';
  END IF;

  IF pg_catalog.has_column_privilege('authenticated', 'public.quiz_event_admissions', 'device_hash', 'SELECT')
    OR pg_catalog.has_column_privilege('authenticated', 'public.quiz_event_admissions', 'normalized_email', 'SELECT')
    OR pg_catalog.has_table_privilege('anon', 'public.quiz_event_admissions', 'SELECT') THEN
    RAISE EXCEPTION 'quiz_event_admissions leaked sensitive columns or anon SELECT'
      USING ERRCODE = 'S1009';
  END IF;

  -- Normalized-email indexes exist (active partial + unfiltered legacy trigger index)
  IF pg_catalog.to_regclass('public.idx_customers_merchant_quiz_normalized_email') IS NULL
    OR pg_catalog.to_regclass('public.idx_customers_merchant_quiz_normalized_email_all') IS NULL THEN
    RAISE EXCEPTION 'normalized-email index missing'
      USING ERRCODE = 'S1010';
  END IF;

  -- Request-scope hook check when installed
  v_hook_proc := pg_catalog.to_regprocedure('public.enforce_gigl_tracking_worker_request_scope()');
  IF v_hook_proc IS NOT NULL THEN
    v_hook_def := pg_catalog.pg_get_functiondef(v_hook_proc);
    IF pg_catalog.strpos(v_hook_def, '/rpc/ingest_quiz_edge_attempt_batch_v2') = 0
      OR pg_catalog.strpos(v_hook_def, '/rpc/record_quiz_edge_room_seal_v2') = 0
      OR pg_catalog.strpos(v_hook_def, '/rpc/get_quiz_edge_reconciliation_status_v2') = 0
      OR pg_catalog.strpos(v_hook_def, '/rpc/score_quiz_edge_staged_batches_incremental_v2') = 0 THEN
      RAISE EXCEPTION 'PostgREST request scope hook missing quiz_edge_batch_worker allowlist'
        USING ERRCODE = 'S1011';
    END IF;
  END IF;
END
$$;

-- ===========================================================================
-- 2. Fixtures: merchant, product, users, customers (incl. alias & minor),
--    events (edge live, edge test, edge cancelled, legacy postgres)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES
  ('88000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'merchant-s1@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice.one+a@gmail.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aliceone@googlemail.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob.two@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol.three@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'minor.four@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'blocked.five@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('88000000-0000-4000-8000-000000000017', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noshow.six@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.merchants (id, user_id, email, business_name, slug, payout_currency)
VALUES (
  '88000000-0000-4000-8000-000000000101',
  '88000000-0000-4000-8000-000000000001',
  'merchant-s1@example.com',
  'Stage1 Merchant',
  'stage1-merchant',
  'NGN'
);

INSERT INTO public.products (id, merchant_id, name, price, status, manage_stock)
VALUES (
  '88000000-0000-4000-8000-000000000201',
  '88000000-0000-4000-8000-000000000101',
  'Stage 1 Prize Phone',
  150000,
  'active',
  false
);

INSERT INTO public.customers (id, merchant_id, user_id, email, first_name, last_name, username, date_of_birth)
VALUES
  ('88000000-0000-4000-8000-000000000311', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000011', 'alice.one+a@gmail.com', 'Alice', 'One', 'aliceone', '1995-01-15'),
  ('88000000-0000-4000-8000-000000000312', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000012', 'aliceone@googlemail.com', 'Alice', 'Alias', 'alicealias', '1995-01-15'),
  ('88000000-0000-4000-8000-000000000313', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000013', 'bob.two@example.com', 'Bob', 'Two', 'bobtwo', '1994-06-20'),
  ('88000000-0000-4000-8000-000000000314', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000014', 'carol.three@example.com', 'Carol', 'Three', 'carolthree', ((pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date - INTERVAL '18 years')::date),
  ('88000000-0000-4000-8000-000000000315', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000015', 'minor.four@example.com', 'Minor', 'Four', 'minorfour', ((pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date - INTERVAL '17 years')::date),
  ('88000000-0000-4000-8000-000000000316', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000016', 'blocked.five@example.com', 'Blocked', 'Five', 'blockedfive', '1993-03-10'),
  ('88000000-0000-4000-8000-000000000317', '88000000-0000-4000-8000-000000000101', '88000000-0000-4000-8000-000000000017', 'noshow.six@example.com', 'NoShow', 'Six', 'noshow_six', '1992-08-05');

-- Events:
--   0401 = edge_rooms LIVE (2 expected rooms)
--   0402 = edge_rooms TEST (1 expected room)
--   0403 = edge_rooms CANCELLED (1 expected room)
--   0404 = legacy postgres LIVE (100% existing trigger behavior)
INSERT INTO public.quiz_events (
  id, merchant_id, slug, title, status, starts_at, ends_at,
  mode, contract_version, rules_version, question_count,
  time_per_question_seconds, maximum_play_seconds, live_window_seconds,
  max_attempts, time_zone, compliance_verified, regulatory_basis,
  regulatory_jurisdiction, regulatory_evidence_ref, claim_window_seconds,
  backend_mode, expected_room_count, settings
) VALUES
  (
    '88000000-0000-4000-8000-000000000401',
    '88000000-0000-4000-8000-000000000101',
    'stage1-edge-live', 'Stage 1 Edge Live', 'active',
    '2026-11-18T10:00:00Z', '2026-11-18T10:05:00Z',
    'live', 2, 's1-v2', 2, 10, 20, 300, 1, 'Africa/Lagos',
    true, 'free_skill_competition', 'NG', 's1-evidence', 3600,
    'edge_rooms', 2,
    '{"prize_product_id":"88000000-0000-4000-8000-000000000201","prize_product_name":"Stage 1 Prize Phone","prize_name":"Stage 1 Prize"}'::jsonb
  ),
  (
    '88000000-0000-4000-8000-000000000402',
    '88000000-0000-4000-8000-000000000101',
    'stage1-edge-test', 'Stage 1 Edge Test', 'active',
    pg_catalog.clock_timestamp() - interval '1 minute',
    pg_catalog.clock_timestamp() + interval '4 minutes',
    'test', 2, 's1-v2', 2, 10, 20, 300, 3, 'Africa/Lagos',
    false, NULL, NULL, NULL, NULL,
    'edge_rooms', 1,
    '{"prize_product_id":"88000000-0000-4000-8000-000000000201","prize_product_name":"Stage 1 Prize Phone","prize_name":"Stage 1 Prize"}'::jsonb
  ),
  (
    '88000000-0000-4000-8000-000000000403',
    '88000000-0000-4000-8000-000000000101',
    'stage1-edge-cancelled', 'Stage 1 Edge Cancelled', 'cancelled',
    '2026-11-18T10:00:00Z', '2026-11-18T10:05:00Z',
    'live', 2, 's1-v2', 2, 10, 20, 300, 1, 'Africa/Lagos',
    true, 'free_skill_competition', 'NG', 's1-evidence', 3600,
    'edge_rooms', 1,
    '{"prize_product_id":"88000000-0000-4000-8000-000000000201","prize_product_name":"Stage 1 Prize Phone","prize_name":"Stage 1 Prize"}'::jsonb
  ),
  (
    '88000000-0000-4000-8000-000000000404',
    '88000000-0000-4000-8000-000000000101',
    'stage1-legacy-pg', 'Stage 1 Legacy PG', 'active',
    pg_catalog.clock_timestamp() - interval '1 minute',
    pg_catalog.clock_timestamp() + interval '4 minutes',
    'live', 2, 's1-v2', 2, 10, 20, 300, 1, 'Africa/Lagos',
    true, 'free_skill_competition', 'NG', 's1-evidence', 3600,
    'postgres', NULL,
    '{"max_attempts":1,"prize_product_id":"88000000-0000-4000-8000-000000000201","prize_product_name":"Stage 1 Prize Phone","prize_name":"Stage 1 Prize"}'::jsonb
  );

INSERT INTO public.quiz_prize_reservations (
  id, event_id, merchant_id, product_id, inventory_kind, state
) VALUES (
  '88000000-0000-4000-8000-000000000491',
  '88000000-0000-4000-8000-000000000401',
  '88000000-0000-4000-8000-000000000101',
  '88000000-0000-4000-8000-000000000201',
  'unlimited',
  'reserved'
);

INSERT INTO public.quiz_event_testers (event_id, merchant_id, user_id)
VALUES (
  '88000000-0000-4000-8000-000000000402',
  '88000000-0000-4000-8000-000000000101',
  '88000000-0000-4000-8000-000000000015'
);

-- Slots & variants (answer key 'opt-a' -> sha256('opt-a'))
INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active) VALUES
  ('88000000-0000-4000-8000-000000000501', '88000000-0000-4000-8000-000000000401', 1, true),
  ('88000000-0000-4000-8000-000000000502', '88000000-0000-4000-8000-000000000401', 2, true),
  ('88000000-0000-4000-8000-000000000521', '88000000-0000-4000-8000-000000000402', 1, true),
  ('88000000-0000-4000-8000-000000000522', '88000000-0000-4000-8000-000000000402', 2, true),
  ('88000000-0000-4000-8000-000000000511', '88000000-0000-4000-8000-000000000404', 1, true),
  ('88000000-0000-4000-8000-000000000512', '88000000-0000-4000-8000-000000000404', 2, true);

INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active) VALUES
  (
    '88000000-0000-4000-8000-000000000601',
    '88000000-0000-4000-8000-000000000501',
    'k1', 'Q1', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '88000000-0000-4000-8000-000000000602',
    '88000000-0000-4000-8000-000000000502',
    'k2', 'Q2', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '88000000-0000-4000-8000-000000000621',
    '88000000-0000-4000-8000-000000000521',
    'k1', 'Q1', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '88000000-0000-4000-8000-000000000622',
    '88000000-0000-4000-8000-000000000522',
    'k2', 'Q2', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '88000000-0000-4000-8000-000000000611',
    '88000000-0000-4000-8000-000000000511',
    'k1', 'Q1', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  ),
  (
    '88000000-0000-4000-8000-000000000612',
    '88000000-0000-4000-8000-000000000512',
    'k2', 'Q2', '[{"id":"opt-a","text":"A"},{"id":"opt-b","text":"B"}]'::jsonb,
    public.quiz_answer_key_hash('opt-a'), true
  );

SET LOCAL session_replication_role = origin;

-- Enable score publication control & fresh runtime control inside rolled-back tx.
UPDATE private.quiz_test_publication_control_v2 SET score_repair_ready = true WHERE singleton;
INSERT INTO public.quiz_runtime_control_v2 (singleton, production_phase, production_approved, updated_at)
VALUES (true, true, true, pg_catalog.clock_timestamp())
ON CONFLICT (singleton) DO UPDATE
SET production_phase = true, production_approved = true, updated_at = pg_catalog.clock_timestamp();

-- ===========================================================================
-- 3. Check-in RPC: age gate, attestation, normalized-email cap, device cap,
--    idempotency, zero quiz_attempts insert, backend lock
-- ===========================================================================
-- Temporarily move event 0401 window into open window for check-in tests, then close it after check-in.
UPDATE public.quiz_events
SET starts_at = pg_catalog.clock_timestamp() - interval '1 minute',
    ends_at = pg_catalog.clock_timestamp() + interval '4 minutes'
WHERE id = '88000000-0000-4000-8000-000000000401';

-- 3a. Under-18 blocked on live (QZ014), allowed on test (0402)
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000015"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000015', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_err text;
  v_adm jsonb;
BEGIN
  BEGIN
    PERFORM public.check_in_quiz_event_v2(
      '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('1', 64),
      's1-v2', true, gen_random_uuid(), '2.0.0', 'ios'
    );
    RAISE EXCEPTION 'minor should have been blocked on live event';
  EXCEPTION WHEN SQLSTATE 'QZ014' THEN
    NULL;
  END;

  -- Minor allowed on test event
  v_adm := public.check_in_quiz_event_v2(
    '88000000-0000-4000-8000-000000000402', pg_catalog.repeat('1', 64),
    's1-v2', true, gen_random_uuid(), '2.0.0', 'ios'
  );
  IF v_adm ->> 'admissionId' IS NULL OR v_adm ->> 'roomId' IS NULL THEN
    RAISE EXCEPTION 'minor test check-in failed: %', v_adm;
  END IF;
END
$$;
RESET ROLE;

-- 3b. Exact 18th birthday (Carol) + optional one-time App Check attestation
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000014"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000014', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_nonce text := pg_catalog.repeat('a', 64);
  v_token text := pg_catalog.repeat('b', 64);
  v_adm jsonb;
  v_adm_retry jsonb;
BEGIN
  PERFORM public.issue_quiz_app_attestation_challenge_v1('88000000-0000-4000-8000-000000000401', v_nonce);

  -- Stale token rejected
  BEGIN
    PERFORM public.check_in_quiz_event_v2(
      '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('4', 64),
      's1-v2', true, gen_random_uuid(), '2.0.0', 'android', 'play_integrity',
      v_nonce, v_token, pg_catalog.clock_timestamp() - interval '1 hour', true
    );
    RAISE EXCEPTION 'stale attestation token was accepted';
  EXCEPTION WHEN SQLSTATE 'QZ049' THEN
    NULL;
  END;

  -- Fresh token accepted & challenge consumed
  v_adm := public.check_in_quiz_event_v2(
    '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('4', 64),
    's1-v2', true, gen_random_uuid(), '2.0.0', 'android', 'play_integrity',
    v_nonce, v_token, pg_catalog.clock_timestamp(), true
  );
  IF COALESCE((v_adm ->> 'reused')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'expected fresh admission, got %', v_adm;
  END IF;

  -- Idempotent retry returns exact same admissionId & roomId with reused=true
  v_adm_retry := public.check_in_quiz_event_v2(
    '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('4', 64),
    's1-v2', true, gen_random_uuid(), '2.0.0', 'android', 'play_integrity',
    v_nonce, v_token, pg_catalog.clock_timestamp(), true
  );
  IF v_adm_retry ->> 'admissionId' IS DISTINCT FROM v_adm ->> 'admissionId'
    OR v_adm_retry ->> 'roomId' IS DISTINCT FROM v_adm ->> 'roomId'
    OR COALESCE((v_adm_retry ->> 'reused')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'idempotent check-in retry mismatch: % vs %', v_adm, v_adm_retry;
  END IF;

  -- Different device for same customer fails with QZ043
  BEGIN
    PERFORM public.check_in_quiz_event_v2(
      '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('9', 64),
      's1-v2', true, gen_random_uuid(), '2.0.0', 'android'
    );
    RAISE EXCEPTION 'device binding conflict was not raised';
  EXCEPTION WHEN SQLSTATE 'QZ043' THEN
    NULL;
  END;
END
$$;
RESET ROLE;

-- 3c. Alice checks in; Alice alias (same normalized gmail, different device) blocked (QZ040);
--     Bob (different email, same device as Alice) blocked (QZ041), then succeeds on own device.
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000011"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000011', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_adm jsonb;
BEGIN
  v_adm := public.check_in_quiz_event_v2(
    '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('2', 64),
    's1-v2', true, gen_random_uuid(), '2.0.0', 'ios'
  );
  IF v_adm ->> 'admissionId' IS NULL OR v_adm ->> 'roomId' IS NULL THEN
    RAISE EXCEPTION 'Alice check-in failed: %', v_adm;
  END IF;
END
$$;
RESET ROLE;

-- Alice alias blocked by normalized-email cap (QZ040)
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000012"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000012', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.check_in_quiz_event_v2(
      '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('8', 64),
      's1-v2', true, gen_random_uuid(), '2.0.0', 'ios'
    );
    RAISE EXCEPTION 'normalized-email alias should have been blocked';
  EXCEPTION WHEN SQLSTATE 'QZ040' THEN
    NULL;
  END;
END
$$;
RESET ROLE;

-- Bob blocked on Alice's device (QZ041), then admitted on Bob's own device
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000013"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000013', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.check_in_quiz_event_v2(
      '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('2', 64),
      's1-v2', true, gen_random_uuid(), '2.0.0', 'web'
    );
    RAISE EXCEPTION 'shared device should have been blocked';
  EXCEPTION WHEN SQLSTATE 'QZ041' THEN
    NULL;
  END;

  PERFORM public.check_in_quiz_event_v2(
    '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('3', 64),
    's1-v2', true, gen_random_uuid(), '2.0.0', 'web'
  );
END
$$;
RESET ROLE;

-- Also check in BlockedFive and NoShowSix
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000016"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000016', true);
SET LOCAL ROLE authenticated;
SELECT public.check_in_quiz_event_v2(
  '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('5', 64),
  's1-v2', true, gen_random_uuid(), '2.0.0', 'web'
);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"88000000-0000-4000-8000-000000000017"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '88000000-0000-4000-8000-000000000017', true);
SET LOCAL ROLE authenticated;
SELECT public.check_in_quiz_event_v2(
  '88000000-0000-4000-8000-000000000401', pg_catalog.repeat('6', 64),
  's1-v2', true, gen_random_uuid(), '2.0.0', 'web'
);
RESET ROLE;

-- Verify check-in inserted ZERO quiz_attempts rows, backend_mode is locked, and legacy SQL start rejects edge_rooms
DO $$
DECLARE
  v_attempts integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_attempts
  FROM public.quiz_attempts WHERE event_id = '88000000-0000-4000-8000-000000000401';
  IF v_attempts <> 0 THEN
    RAISE EXCEPTION 'check-in must not insert into quiz_attempts (found %)', v_attempts;
  END IF;

  BEGIN
    UPDATE public.quiz_events SET backend_mode = 'postgres'
    WHERE id = '88000000-0000-4000-8000-000000000401';
    RAISE EXCEPTION 'backend_mode mutation should have been locked';
  EXCEPTION WHEN SQLSTATE 'QZ060' THEN
    NULL;
  END;
END
$$;

-- ===========================================================================
-- 4. Legacy postgres triggers remain 100% active on backend_mode='postgres'
-- ===========================================================================
DO $$
DECLARE
  v_attempt_id uuid := '88000000-0000-4000-8000-000000000701';
  v_q_id uuid := '88000000-0000-4000-8000-000000000702';
  v_score integer;
  v_standing_score integer;
BEGIN
  INSERT INTO public.quiz_attempts (
    id, event_id, customer_id, status, attempt_number, started_at, submitted_at, leaderboard_username
  ) VALUES (
    v_attempt_id,
    '88000000-0000-4000-8000-000000000404',
    '88000000-0000-4000-8000-000000000311',
    'submitted', 1,
    pg_catalog.clock_timestamp() - interval '5 seconds',
    pg_catalog.clock_timestamp(),
    'aliceone'
  );

  INSERT INTO public.quiz_attempt_questions (id, attempt_id, slot_id, variant_id, position)
  VALUES (v_q_id, v_attempt_id, '88000000-0000-4000-8000-000000000511', '88000000-0000-4000-8000-000000000611', 1);

  INSERT INTO public.quiz_attempt_answers (attempt_question_id, answer_payload, answered_at, answered_in_ms, score_delta)
  VALUES (v_q_id, '{"v2":true}'::jsonb, pg_catalog.clock_timestamp(), 500, 1);

  SELECT score INTO v_score FROM public.quiz_attempts WHERE id = v_attempt_id;
  SELECT score INTO v_standing_score FROM public.quiz_live_standings_v2 WHERE attempt_id = v_attempt_id;
  IF v_score <> 1 OR v_standing_score <> 1 THEN
    RAISE EXCEPTION 'legacy postgres triggers did not fire (score=%, standing=%)', v_score, v_standing_score;
  END IF;

  -- Legacy identity cap trigger must still block Alice alias on legacy event
  BEGIN
    INSERT INTO public.quiz_attempts (
      event_id, customer_id, status, attempt_number
    ) VALUES (
      '88000000-0000-4000-8000-000000000404',
      '88000000-0000-4000-8000-000000000312',
      'started', 1
    );
    RAISE EXCEPTION 'legacy identity cap trigger did not block alias';
  EXCEPTION WHEN SQLSTATE 'QZ040' THEN
    NULL;
  END;
END
$$;

-- ===========================================================================
-- 5. Edge scoring, partial attempts, tiebreak, signal-flag block, withheld seal,
--    interrupted scoring, double-import idempotency, two-fact gate & award
-- ===========================================================================
-- Close event 0401 at fixed scheduled window so timestamps match deterministic fixture
UPDATE public.quiz_events
SET starts_at = '2026-11-18T10:00:00.000Z',
    ends_at = '2026-11-18T10:05:00.000Z'
WHERE id = '88000000-0000-4000-8000-000000000401';

-- Act as restricted quiz_edge_batch_worker to ingest batches across rooms 0 and 1.
-- Fixture cases (event ends 10:05:00.000Z, persisted_close_at = 10:05:00.250Z):
--   * BlockedFive (316): 2/2 fast (200ms), BUT has severity='block' signal flag -> excluded from rank & award!
--   * Alice (311): 2/2, elapsed = 3000ms (10:00:10.000Z -> 10:00:13.000Z) -> Rank 2
--   * Bob (313):   2/2, elapsed = 2999ms (10:00:10.000Z -> 10:00:12.999Z) -> Rank 1 (1ms tiebreak!)
--   * Carol (314): partial 1/2 (disconnected before Q2), elapsed with persisted_close_at -> Rank 3
--   * NoShowSix (317): admitted, NEVER started -> zero attempt row!
SET LOCAL ROLE quiz_edge_batch_worker;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', true);

DO $$
DECLARE
  v_event_id uuid := '88000000-0000-4000-8000-000000000401';
  v_room0 text := '88000000-0000-4000-8000-000000000401:room-0000';
  v_room1 text := '88000000-0000-4000-8000-000000000401:room-0001';
  v_res jsonb;
  v_attempts_r0 jsonb;
  v_attempts_r1 jsonb;
BEGIN
  v_attempts_r0 := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000801',
      'customer_id', '88000000-0000-4000-8000-000000000311',
      'attempt_number', 1,
      'leaderboard_username', 'aliceone',
      'started_at', '2026-11-18T10:00:10.000Z',
      'submitted_at', '2026-11-18T10:00:13.000Z',
      'close_reason', 'completed',
      'bundle_checksum_sha256', pg_catalog.repeat('1', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000601', 'position', 1, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:00:10.000Z', 'received_at', '2026-11-18T10:00:11.000Z', 'raw_answer', 'opt-a', 'timeout', false),
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000602', 'position', 2, 'option_order', '["opt-b","opt-a"]'::jsonb, 'issued_at', '2026-11-18T10:00:11.500Z', 'received_at', '2026-11-18T10:00:13.000Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    ),
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000802',
      'customer_id', '88000000-0000-4000-8000-000000000313',
      'attempt_number', 1,
      'leaderboard_username', 'bobtwo',
      'started_at', '2026-11-18T10:00:10.000Z',
      'submitted_at', '2026-11-18T10:00:12.999Z',
      'close_reason', 'completed',
      'bundle_checksum_sha256', pg_catalog.repeat('2', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000601', 'position', 1, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:00:10.000Z', 'received_at', '2026-11-18T10:00:11.000Z', 'raw_answer', 'opt-a', 'timeout', false),
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000602', 'position', 2, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:00:11.500Z', 'received_at', '2026-11-18T10:00:12.999Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    )
  );

  v_attempts_r1 := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000803',
      'customer_id', '88000000-0000-4000-8000-000000000314',
      'attempt_number', 1,
      'leaderboard_username', 'carolthree',
      'started_at', '2026-11-18T10:04:50.000Z',
      'submitted_at', NULL,
      'close_reason', 'event_ended',
      'bundle_checksum_sha256', pg_catalog.repeat('3', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000601', 'position', 1, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:04:50.000Z', 'received_at', '2026-11-18T10:04:51.000Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    ),
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000804',
      'customer_id', '88000000-0000-4000-8000-000000000316',
      'attempt_number', 1,
      'leaderboard_username', 'blockedfive',
      'started_at', '2026-11-18T10:00:10.000Z',
      'submitted_at', '2026-11-18T10:00:10.200Z',
      'close_reason', 'completed',
      'bundle_checksum_sha256', pg_catalog.repeat('4', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000601', 'position', 1, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:00:10.000Z', 'received_at', '2026-11-18T10:00:10.100Z', 'raw_answer', 'opt-a', 'timeout', false),
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000602', 'position', 2, 'option_order', '["opt-a","opt-b"]'::jsonb, 'issued_at', '2026-11-18T10:00:10.100Z', 'received_at', '2026-11-18T10:00:10.200Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    )
  );

  v_res := public.ingest_quiz_edge_attempt_batch_v2(
    v_event_id, v_room0, 'b-r0-1', pg_catalog.repeat('a', 64), 2, 4, v_attempts_r0
  );
  IF COALESCE((v_res ->> 'attemptsInserted')::integer, 0) <> 2 THEN
    RAISE EXCEPTION 'expected 2 attempts in room 0 batch, got %', v_res;
  END IF;

  -- Idempotent double-import of batch b-r0-1
  v_res := public.ingest_quiz_edge_attempt_batch_v2(
    v_event_id, v_room0, 'b-r0-1', pg_catalog.repeat('a', 64), 2, 4, v_attempts_r0
  );
  IF COALESCE((v_res ->> 'duplicate')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected duplicate=true on redelivery, got %', v_res;
  END IF;

  v_res := public.ingest_quiz_edge_attempt_batch_v2(
    v_event_id, v_room1, 'b-r1-1', pg_catalog.repeat('b', 64), 2, 3, v_attempts_r1
  );

  -- Seal ONLY room 0 (withhold room 1)
  PERFORM public.record_quiz_edge_room_seal_v2(
    v_event_id, v_room0, '2026-11-18T10:05:00.250Z', 'completed',
    2, 4, ARRAY['b-r0-1'], 1, pg_catalog.repeat('c', 64)
  );

  v_res := public.get_quiz_edge_reconciliation_status_v2(v_event_id);
  IF COALESCE((v_res ->> 'manifestReconciled')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'withheld seal should not reconcile: %', v_res;
  END IF;

  -- Incremental pre-scoring AS quiz_edge_batch_worker BEFORE manifestReconciled:
  -- scores 1 batch into private.quiz_edge_scored_attempts without publishing!
  v_res := public.score_quiz_edge_staged_batches_incremental_v2(v_event_id, 1);
  IF COALESCE((v_res ->> 'batchesScored')::integer, -1) <> 1
    OR COALESCE((v_res ->> 'remainingUnscoredBatches')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'unexpected incremental pre-score result: %', v_res;
  END IF;
END
$$;
RESET ROLE;

-- Verify incremental pre-score did NOT touch canonical/live tables,
-- canonical backfill blocks pre-scoring-run, and deadline/triggers still block!
DO $$
DECLARE
  v_deadlines jsonb;
  v_pub timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM public.quiz_attempts WHERE event_id = '88000000-0000-4000-8000-000000000401')
    OR EXISTS (SELECT 1 FROM public.quiz_event_results_v2 WHERE event_id = '88000000-0000-4000-8000-000000000401')
    OR EXISTS (SELECT 1 FROM public.quiz_live_standings_v2 WHERE event_id = '88000000-0000-4000-8000-000000000401') THEN
    RAISE EXCEPTION 'incremental pre-scoring leaked into canonical or live standings tables';
  END IF;

  BEGIN
    PERFORM private.backfill_quiz_edge_canonical_answers_v2('88000000-0000-4000-8000-000000000401', 10);
    RAISE EXCEPTION 'canonical backfill must block before scoring run completes';
  EXCEPTION WHEN SQLSTATE 'QZ068' THEN
    NULL;
  END;

  BEGIN
    PERFORM private.score_and_materialize_edge_quiz_event_v2('88000000-0000-4000-8000-000000000401');
    RAISE EXCEPTION 'scoring must fail while room seal is withheld';
  EXCEPTION WHEN SQLSTATE 'QZ068' THEN
    NULL;
  END;

  v_deadlines := public.process_due_quiz_deadlines_v2(true, true);
  SELECT results_published_at INTO v_pub
  FROM public.quiz_events WHERE id = '88000000-0000-4000-8000-000000000401';
  IF v_pub IS NOT NULL THEN
    RAISE EXCEPTION 'process_due_quiz_deadlines_v2 published with withheld seal';
  END IF;

  BEGIN
    UPDATE public.quiz_events SET results_published_at = pg_catalog.clock_timestamp()
    WHERE id = '88000000-0000-4000-8000-000000000401';
    RAISE EXCEPTION 'publication trigger failed to block withheld seal';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$$;

-- Now seal room 1 as worker
SET LOCAL ROLE quiz_edge_batch_worker;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', true);
SELECT public.record_quiz_edge_room_seal_v2(
  '88000000-0000-4000-8000-000000000401',
  '88000000-0000-4000-8000-000000000401:room-0001',
  '2026-11-18T10:05:00.250Z', 'completed',
  2, 3, ARRAY['b-r1-1'], 1, pg_catalog.repeat('d', 64)
);
RESET ROLE;

-- Simulate halfway-interrupted scoring run ('running' in quiz_edge_scoring_runs):
-- Publication MUST STILL BE BLOCKED (Fact 2 missing)!
DO $$
DECLARE
  v_pub timestamptz;
BEGIN
  INSERT INTO private.quiz_edge_scoring_runs (
    event_id, manifest_checksum_sha256, persisted_close_at,
    expected_rooms, sealed_rooms, total_batches, total_attempts, status
  ) VALUES (
    '88000000-0000-4000-8000-000000000401',
    (private.quiz_edge_reconciliation_snapshot_v2('88000000-0000-4000-8000-000000000401') ->> 'manifestChecksumSha256'),
    '2026-11-18T10:05:00.250Z', 2, 2, 2, 4, 'running'
  );

  PERFORM public.process_due_quiz_deadlines_v2(true, true);
  SELECT results_published_at INTO v_pub
  FROM public.quiz_events WHERE id = '88000000-0000-4000-8000-000000000401';
  IF v_pub IS NOT NULL THEN
    RAISE EXCEPTION 'publication leaked during halfway-interrupted scoring run';
  END IF;
END
$$;

-- Now complete set-wise scoring, add severity='block' signal flag for BlockedFive,
-- re-run scoring idempotently, and finalize awards!
DO $$
DECLARE
  v_event_id uuid := '88000000-0000-4000-8000-000000000401';
  v_run1 jsonb;
  v_run2 jsonb;
  v_deadlines jsonb;
  v_rank1_attempt uuid;
  v_rank2_attempt uuid;
  v_rank3_attempt uuid;
  v_results_count integer;
  v_awards_count integer;
  v_award_customer uuid;
  v_live_standings_count integer;
  v_carol_submitted_at timestamptz;
  v_bf1 jsonb;
  v_bf2 jsonb;
  v_bf3 jsonb;
  v_q_count integer;
  v_a_count integer;
BEGIN
  v_run1 := private.score_and_materialize_edge_quiz_event_v2(v_event_id);
  IF COALESCE((v_run1 ->> 'tailBatchesScored')::integer, -1) <> 1
    OR COALESCE((v_run1 ->> 'questionsWritten')::integer, -1) <> 0
    OR COALESCE((v_run1 ->> 'answersWritten')::integer, -1) <> 0 THEN
    RAISE EXCEPTION 'expected 1 tail batch scored and deferred answer backfill, got %', v_run1
      USING ERRCODE = 'S1011';
  END IF;

  -- Attach block signal flag to BlockedFive's attempt and re-score (simulating moderation before publication)
  INSERT INTO public.quiz_attempt_signal_flags (attempt_id, signal_key, severity)
  VALUES ('88000000-0000-4000-8000-000000000804', 'bot_timing', 'block');

  -- Second scoring pass (idempotent double-import check)
  v_run2 := private.score_and_materialize_edge_quiz_event_v2(v_event_id);
  IF COALESCE((v_run2 ->> 'attemptsWritten')::integer, -1) <> 0
    OR COALESCE((v_run2 ->> 'questionsWritten')::integer, -1) <> 0
    OR COALESCE((v_run2 ->> 'answersWritten')::integer, -1) <> 0 THEN
    RAISE EXCEPTION 'second scoring pass should write 0 new attempt/question/answer rows, got %', v_run2
      USING ERRCODE = 'S1012';
  END IF;

  -- Trigger isolation: zero rows in quiz_live_standings_v2 for edge event
  SELECT pg_catalog.count(*)::integer INTO v_live_standings_count
  FROM public.quiz_live_standings_v2 WHERE event_id = v_event_id;
  IF v_live_standings_count <> 0 THEN
    RAISE EXCEPTION 'edge scoring leaked % rows into quiz_live_standings_v2', v_live_standings_count
      USING ERRCODE = 'S1013';
  END IF;

  -- Partial attempt Carol received persisted_close_at
  SELECT submitted_at INTO v_carol_submitted_at
  FROM public.quiz_attempts WHERE id = '88000000-0000-4000-8000-000000000803';
  IF v_carol_submitted_at IS DISTINCT FROM '2026-11-18T10:05:00.250Z'::timestamptz THEN
    RAISE EXCEPTION 'partial attempt did not receive persisted_close_at (got %)', v_carol_submitted_at
      USING ERRCODE = 'S1014';
  END IF;

  -- Run real deadline orchestration -> publishes and mints exactly 1 award for Bob (1ms tiebreak)
  v_deadlines := public.process_due_quiz_deadlines_v2(true, true);

  SELECT pg_catalog.count(*)::integer INTO v_results_count
  FROM public.quiz_event_results_v2 WHERE event_id = v_event_id;
  IF v_results_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 ranked results (BlockedFive excluded, NoShowSix absent), got %', v_results_count
      USING ERRCODE = 'S1015';
  END IF;

  SELECT attempt_id INTO v_rank1_attempt FROM public.quiz_event_results_v2 WHERE event_id = v_event_id AND rank = 1;
  SELECT attempt_id INTO v_rank2_attempt FROM public.quiz_event_results_v2 WHERE event_id = v_event_id AND rank = 2;
  SELECT attempt_id INTO v_rank3_attempt FROM public.quiz_event_results_v2 WHERE event_id = v_event_id AND rank = 3;
  IF v_rank1_attempt IS DISTINCT FROM '88000000-0000-4000-8000-000000000802'
    OR v_rank2_attempt IS DISTINCT FROM '88000000-0000-4000-8000-000000000801'
    OR v_rank3_attempt IS DISTINCT FROM '88000000-0000-4000-8000-000000000803' THEN
    RAISE EXCEPTION 'unexpected ranking order: r1=%, r2=%, r3=%', v_rank1_attempt, v_rank2_attempt, v_rank3_attempt
      USING ERRCODE = 'S1016';
  END IF;

  SELECT pg_catalog.count(*)::integer, pg_catalog.max(customer_id::text)::uuid
  INTO v_awards_count, v_award_customer
  FROM public.quiz_awards WHERE event_id = v_event_id;
  IF v_awards_count <> 1 OR v_award_customer IS DISTINCT FROM '88000000-0000-4000-8000-000000000313' THEN
    IF COALESCE((v_deadlines ->> 'runtimeGateFresh')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'runtimeGateFresh=false: %', v_deadlines USING ERRCODE = 'S1021';
    END IF;
    IF COALESCE((v_deadlines ->> 'liveFinalizationFailed')::integer, 0) > 0 THEN
      RAISE EXCEPTION 'liveFinalizationFailed: %', v_deadlines USING ERRCODE = 'S1022';
    END IF;
    IF COALESCE((v_deadlines ->> 'liveAwaitingGate')::integer, 0) > 0
      AND COALESCE((v_deadlines ->> 'failed')::integer, 0) = 0 THEN
      RAISE EXCEPTION 'liveAwaitingGate: %', v_deadlines USING ERRCODE = 'S1023';
    END IF;
    IF COALESCE((v_deadlines ->> 'failed')::integer, 0) > 0 THEN
      PERFORM private.transfer_quiz_prize_to_winner_v2(
        v_event_id, v_rank1_attempt, '88000000-0000-4000-8000-000000000313'
      );
      UPDATE public.quiz_events
      SET status = 'completed',
          finalization_state = 'awarded',
          results_published_at = pg_catalog.clock_timestamp()
      WHERE id = v_event_id;
      RAISE EXCEPTION 'failed>0 but direct transfer+publish succeeded: %', v_deadlines USING ERRCODE = 'S1024';
    END IF;
    RAISE EXCEPTION 'expected 1 award for Bob (313), got count=%, customer=%, deadlines=%',
      v_awards_count, v_award_customer, v_deadlines
      USING ERRCODE = 'S1017';
  END IF;

  -- Post-publish idempotent canonical question/answer backfill in chunks of 2 attempts
  v_bf1 := private.backfill_quiz_edge_canonical_answers_v2(v_event_id, 2);
  v_bf2 := private.backfill_quiz_edge_canonical_answers_v2(v_event_id, 2);
  v_bf3 := private.backfill_quiz_edge_canonical_answers_v2(v_event_id, 2);
  IF COALESCE((v_bf1 ->> 'attemptsBackfilled')::integer, -1) <> 2
    OR COALESCE((v_bf1 ->> 'remainingAttempts')::integer, -1) <> 2
    OR COALESCE((v_bf2 ->> 'attemptsBackfilled')::integer, -1) <> 2
    OR COALESCE((v_bf2 ->> 'remainingAttempts')::integer, -1) <> 0
    OR COALESCE((v_bf3 ->> 'attemptsBackfilled')::integer, -1) <> 0
    OR COALESCE((v_bf3 ->> 'questionsWritten')::integer, -1) <> 0
    OR COALESCE((v_bf3 ->> 'answersWritten')::integer, -1) <> 0 THEN
    RAISE EXCEPTION 'canonical answer backfill chunking/idempotency mismatch: %, %, %', v_bf1, v_bf2, v_bf3
      USING ERRCODE = 'S1018';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_q_count
  FROM public.quiz_attempt_questions AS q
  JOIN public.quiz_attempts AS a ON a.id = q.attempt_id
  WHERE a.event_id = v_event_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_a_count
  FROM public.quiz_attempt_answers AS ans
  JOIN public.quiz_attempt_questions AS q ON q.id = ans.attempt_question_id
  JOIN public.quiz_attempts AS a ON a.id = q.attempt_id
  WHERE a.event_id = v_event_id;

  IF v_q_count <> 7 OR v_a_count <> 7 THEN
    RAISE EXCEPTION 'expected 7 backfilled canonical questions & answers, got q=%, a=%', v_q_count, v_a_count
      USING ERRCODE = 'S1019';
  END IF;
END
$$;

-- ===========================================================================
-- 6. Cancelled edge event seals audit record with 0 results & 0 awards
-- ===========================================================================
SET LOCAL ROLE quiz_edge_batch_worker;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', true);
SELECT public.record_quiz_edge_room_seal_v2(
  '88000000-0000-4000-8000-000000000403',
  '88000000-0000-4000-8000-000000000403:room-0000',
  '2026-11-18T10:02:00.000Z', 'cancelled',
  0, 0, ARRAY[]::text[], 0, pg_catalog.repeat('e', 64)
);
RESET ROLE;

DO $$
DECLARE
  v_event_id uuid := '88000000-0000-4000-8000-000000000403';
  v_pub timestamptz;
  v_awards integer;
  v_results integer;
BEGIN
  PERFORM private.score_and_materialize_edge_quiz_event_v2(v_event_id);
  PERFORM public.process_due_quiz_deadlines_v2(true, true);

  SELECT results_published_at INTO v_pub FROM public.quiz_events WHERE id = v_event_id;
  SELECT pg_catalog.count(*)::integer INTO v_awards FROM public.quiz_awards WHERE event_id = v_event_id;
  SELECT pg_catalog.count(*)::integer INTO v_results FROM public.quiz_event_results_v2 WHERE event_id = v_event_id;

  IF v_pub IS NOT NULL OR v_awards <> 0 OR v_results <> 0 THEN
    RAISE EXCEPTION 'cancelled event must produce 0 results/awards and stay unpublished (pub=%, awards=%, results=%)',
      v_pub, v_awards, v_results;
  END IF;
END
$$;

-- ===========================================================================
-- 7. Test-mode edge event: late/post-end answers, 0-answer started attempt,
--    submitted_at & attempt_id tiebreaks, and finalize_due_test_quiz_events_v2
-- ===========================================================================
UPDATE public.quiz_events
SET starts_at = '2026-11-18T10:00:00.000Z',
    ends_at = '2026-11-18T10:05:00.000Z'
WHERE id = '88000000-0000-4000-8000-000000000402';

-- Before sealing/scoring, finalize_due_test_quiz_events_v2 MUST NOT publish 0402
DO $$
DECLARE
  v_pub timestamptz;
BEGIN
  PERFORM public.finalize_due_test_quiz_events_v2();
  SELECT results_published_at INTO v_pub
  FROM public.quiz_events WHERE id = '88000000-0000-4000-8000-000000000402';
  IF v_pub IS NOT NULL THEN
    RAISE EXCEPTION 'test edge event published before seal & scoring';
  END IF;
END
$$;

SET LOCAL ROLE quiz_edge_batch_worker;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', true);
DO $$
DECLARE
  v_event_id uuid := '88000000-0000-4000-8000-000000000402';
  v_room text := '88000000-0000-4000-8000-000000000402:room-0000';
  v_batch jsonb;
BEGIN
  -- 1) Alice (311): score 1, elapsed 2000ms, submitted 10:00:12.000Z (attempt ...901)
  -- 2) Bob (313):   score 1, elapsed 2000ms, submitted 10:00:12.000Z (attempt ...900 -> smaller attempt_id wins!)
  -- 3) Carol (314): score 1 (Q1 on-time, Q2 late at exact deadline >= issued_at + 10s -> 0), elapsed 2000ms, submitted 10:00:13.000Z
  -- 4) Minor (315): 0-answer started attempt -> score 0, submitted_at = persisted_close_at
  v_batch := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000901',
      'customer_id', '88000000-0000-4000-8000-000000000311',
      'attempt_number', 1, 'leaderboard_username', 'aliceone',
      'started_at', '2026-11-18T10:00:10.000Z',
      'submitted_at', '2026-11-18T10:00:12.000Z',
      'close_reason', 'completed', 'bundle_checksum_sha256', pg_catalog.repeat('1', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000621', 'position', 1, 'issued_at', '2026-11-18T10:00:10.000Z', 'received_at', '2026-11-18T10:00:11.000Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    ),
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000900',
      'customer_id', '88000000-0000-4000-8000-000000000313',
      'attempt_number', 1, 'leaderboard_username', 'bobtwo',
      'started_at', '2026-11-18T10:00:10.000Z',
      'submitted_at', '2026-11-18T10:00:12.000Z',
      'close_reason', 'completed', 'bundle_checksum_sha256', pg_catalog.repeat('2', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000621', 'position', 1, 'issued_at', '2026-11-18T10:00:10.000Z', 'received_at', '2026-11-18T10:00:11.000Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    ),
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000902',
      'customer_id', '88000000-0000-4000-8000-000000000314',
      'attempt_number', 1, 'leaderboard_username', 'carolthree',
      'started_at', '2026-11-18T10:00:11.000Z',
      'submitted_at', '2026-11-18T10:00:13.000Z',
      'close_reason', 'completed', 'bundle_checksum_sha256', pg_catalog.repeat('3', 64),
      'answers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000621', 'position', 1, 'issued_at', '2026-11-18T10:00:11.000Z', 'received_at', '2026-11-18T10:00:12.000Z', 'raw_answer', 'opt-a', 'timeout', false),
        pg_catalog.jsonb_build_object('variant_id', '88000000-0000-4000-8000-000000000622', 'position', 2, 'issued_at', '2026-11-18T10:00:12.000Z', 'received_at', '2026-11-18T10:00:22.000Z', 'raw_answer', 'opt-a', 'timeout', false)
      )
    ),
    pg_catalog.jsonb_build_object(
      'attempt_id', '88000000-0000-4000-8000-000000000903',
      'customer_id', '88000000-0000-4000-8000-000000000315',
      'attempt_number', 1, 'leaderboard_username', 'minorfour',
      'started_at', '2026-11-18T10:04:55.000Z',
      'submitted_at', NULL,
      'close_reason', 'event_closed', 'bundle_checksum_sha256', pg_catalog.repeat('4', 64),
      'answers', '[]'::jsonb
    )
  );
  PERFORM public.ingest_quiz_edge_attempt_batch_v2(
    v_event_id, v_room, 'b-test-1', pg_catalog.repeat('f', 64), 4, 4, v_batch
  );
  PERFORM public.record_quiz_edge_room_seal_v2(
    v_event_id, v_room, '2026-11-18T10:05:00.100Z', 'completed',
    4, 4, ARRAY['b-test-1'], 1, pg_catalog.repeat('e', 64)
  );
END
$$;
RESET ROLE;

DO $$
DECLARE
  v_event_id uuid := '88000000-0000-4000-8000-000000000402';
  v_ranks uuid[];
  v_pub timestamptz;
  v_carol_score integer;
  v_minor_score integer;
BEGIN
  PERFORM private.score_and_materialize_edge_quiz_event_v2(v_event_id);
  PERFORM public.finalize_due_test_quiz_events_v2();

  SELECT results_published_at INTO v_pub FROM public.quiz_events WHERE id = v_event_id;
  IF v_pub IS NULL THEN
    RAISE EXCEPTION 'test edge event did not publish after seal & scoring';
  END IF;

  SELECT score INTO v_carol_score FROM public.quiz_attempts WHERE id = '88000000-0000-4000-8000-000000000902';
  SELECT score INTO v_minor_score FROM public.quiz_attempts WHERE id = '88000000-0000-4000-8000-000000000903';
  IF v_carol_score <> 1 OR v_minor_score <> 0 THEN
    RAISE EXCEPTION 'unexpected late/0-answer scores: carol=%, minor=%', v_carol_score, v_minor_score;
  END IF;

  SELECT pg_catalog.array_agg(attempt_id ORDER BY rank)
  INTO v_ranks
  FROM public.quiz_event_results_v2
  WHERE event_id = v_event_id;

  IF v_ranks IS DISTINCT FROM ARRAY[
    '88000000-0000-4000-8000-000000000900'::uuid,
    '88000000-0000-4000-8000-000000000901'::uuid,
    '88000000-0000-4000-8000-000000000902'::uuid,
    '88000000-0000-4000-8000-000000000903'::uuid
  ] THEN
    RAISE EXCEPTION 'tiebreak order mismatch (attempt_id & submitted_at): %', v_ranks;
  END IF;
END
$$;

ROLLBACK;
