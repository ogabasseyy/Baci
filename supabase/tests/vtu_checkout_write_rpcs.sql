-- =====================================================================
-- REGRESSION TEST: wallet-only checkout RLS boundary, part 2
-- (prepare-insert, idempotency lookup, claim hardening, orphan-fail
-- RPCs) — epic #3694 Phase 2.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/vtu_checkout_write_rpcs.sql
--
-- Part 1 (buyer SELECT policy, write default-deny, customer
-- find/link, settings projection) lives in vtu_checkout_rls.sql.
-- =====================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_m1 uuid := 'e2e2e2e2-0000-4000-8000-000000000001';
  v_m2 uuid := 'e2e2e2e2-0000-4000-8000-000000000002';
  v_u1 uuid := 'b22df000-0000-4000-8000-000000000001';
  v_u2 uuid := 'b22df000-0000-4000-8000-000000000002';
  v_u3 uuid := 'b22df000-0000-4000-8000-000000000003';
  v_c1 uuid := 'f3f3f3f3-0000-4000-8000-000000000001';
  v_c2 uuid := 'f3f3f3f3-0000-4000-8000-000000000002';
  v_c3 uuid := 'f3f3f3f3-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'wrpc-m1@example.com', 'WRPC M1', 'wrpc-m1'),
    (v_m2, 'wrpc-m2@example.com', 'WRPC M2', 'wrpc-m2');

  RESET ROLE;
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'wrpc-u1@example.com', 'test', now(),
     now(), now(), '{}', '{}'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'wrpc-u2@example.com', 'test', now(),
     now(), now(), '{}', '{}'),
    (v_u3, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'wrpc-u3@example.com', 'test', now(),
     now(), now(), '{}', '{}');
  SET LOCAL ROLE service_role;

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES
    (v_c1, v_m1, 'wrpc-u1@example.com', v_u1),
    (v_c2, v_m1, 'wrpc-u2@example.com', v_u2),
    (v_c3, v_m2, 'wrpc-u3@example.com', v_u3);

  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status
  )
  VALUES
    ('d4d4d4d4-0000-4000-8000-000000000001', v_m1, v_c1, 'airtime', 'mtn',
     '08030000011', 500, 'WRPC-001', 'pending'),
    ('d4d4d4d4-0000-4000-8000-000000000002', v_m1, v_c2, 'airtime', 'mtn',
     '08030000012', 500, 'WRPC-002', 'pending'),
    ('d4d4d4d4-0000-4000-8000-000000000003', v_m1, v_c1, 'airtime', 'mtn',
     '08030000013', 500, 'WRPC-003', 'processing');

  INSERT INTO public.vtu_idempotency_keys (
    key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint
  )
  VALUES
    ('e5e5e5e5-0000-4000-8000-000000000001',
     'd4d4d4d4-0000-4000-8000-000000000001', v_c1, v_m1, 'wrpc-fp-1'),
    ('e5e5e5e5-0000-4000-8000-000000000002',
     'd4d4d4d4-0000-4000-8000-000000000002', v_c2, v_m1, 'wrpc-fp-2');
END;
$fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true
);

-- --- I1: owner insert records the full prepared row -------------------
DO $i1$
DECLARE
  v_prepared record;
  v_row record;
BEGIN
  SELECT * INTO v_prepared
  FROM public.insert_prepared_vtu_transaction(
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000001',
    NULL, 'airtime', 'mtn', '08030000014', 500, 'WRPC-INSERT-001',
    'checkout', 25, 50, 5,
    NULL, NULL, NULL, NULL,
    '{"provider":"kuda","paymentSplit":{"wallet":500,"card":0}}'::jsonb
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'I1: insert returned zero rows';
  END IF;
  IF v_prepared.status IS DISTINCT FROM 'pending'
    OR v_prepared.type IS DISTINCT FROM 'airtime'
    OR v_prepared.amount IS DISTINCT FROM 500
    OR v_prepared.request_reference IS DISTINCT FROM 'WRPC-INSERT-001'
  THEN
    RAISE EXCEPTION 'I1: prepared shape wrong: %', row_to_json(v_prepared);
  END IF;

  SET LOCAL ROLE service_role;
  SELECT * INTO v_row
  FROM public.vtu_transactions
  WHERE request_reference = 'WRPC-INSERT-001';
  SET LOCAL ROLE authenticated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'I1: inserted row not found';
  END IF;
  IF v_row.merchant_id IS DISTINCT FROM 'e2e2e2e2-0000-4000-8000-000000000001'
    OR v_row.customer_id IS DISTINCT FROM 'f3f3f3f3-0000-4000-8000-000000000001'
    OR v_row.platform_commission IS DISTINCT FROM 25
    OR v_row.merchant_commission IS DISTINCT FROM 50
    OR v_row.customer_cashback IS DISTINCT FROM 5
    OR v_row.source IS DISTINCT FROM 'checkout'
    OR v_row.metadata IS DISTINCT FROM
      '{"provider":"kuda","paymentSplit":{"wallet":500,"card":0}}'::jsonb
    OR v_row.transaction_id IS NOT NULL
    OR v_row.error_message IS NOT NULL
  THEN
    RAISE EXCEPTION 'I1: persisted row wrong: %', row_to_json(v_row);
  END IF;
END;
$i1$;

-- --- I2: cross-customer insert is refused -----------------------------
DO $i2$
BEGIN
  BEGIN
    PERFORM public.insert_prepared_vtu_transaction(
      'e2e2e2e2-0000-4000-8000-000000000001',
      'f3f3f3f3-0000-4000-8000-000000000002',
      'b22df000-0000-4000-8000-000000000001',
      NULL, 'airtime', 'mtn', '08030000015', 500, 'WRPC-INSERT-002',
      'checkout', 25, 50, 5,
      NULL, NULL, NULL, NULL, '{}'::jsonb
    );
    RAISE EXCEPTION 'I2: cross-customer insert unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'not authorized%' THEN
      RAISE EXCEPTION 'I2: wrong raise: %', SQLERRM;
    END IF;
  END;
END;
$i2$;

-- --- I3: service_role (server callers, no JWT) still inserts ---------
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $i3$
DECLARE
  v_prepared record;
BEGIN
  SELECT * INTO v_prepared
  FROM public.insert_prepared_vtu_transaction(
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000002',
    'b22df000-0000-4000-8000-000000000002',
    NULL, 'data', 'glo', '08030000016', 1000, 'WRPC-INSERT-003',
    'checkout', 50, 100, 0,
    NULL, NULL, NULL, NULL, '{}'::jsonb
  );
  IF NOT FOUND OR v_prepared.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'I3: service_role insert failed';
  END IF;
END;
$i3$;

-- --- K1: fresh key ----------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true
);

DO $k1$
DECLARE
  v_lookup record;
BEGIN
  SELECT * INTO v_lookup
  FROM public.lookup_vtu_idempotency_row(
    'e5e5e5e5-0000-4000-8000-000000000099',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'K1: lookup must always return a verdict row';
  END IF;
  IF v_lookup.verdict IS DISTINCT FROM 'fresh'
    OR v_lookup.vtu_transaction_id IS NOT NULL
    OR v_lookup.customer_id IS NOT NULL
    OR v_lookup.merchant_id IS NOT NULL
    OR v_lookup.request_fingerprint IS NOT NULL
  THEN
    RAISE EXCEPTION 'K1: fresh verdict wrong: %', row_to_json(v_lookup);
  END IF;
END;
$k1$;

-- --- K2: owned key returns the full row -------------------------------
DO $k2$
DECLARE
  v_lookup record;
BEGIN
  SELECT * INTO v_lookup
  FROM public.lookup_vtu_idempotency_row(
    'e5e5e5e5-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF v_lookup.verdict IS DISTINCT FROM 'owned'
    OR v_lookup.vtu_transaction_id IS DISTINCT FROM 'd4d4d4d4-0000-4000-8000-000000000001'
    OR v_lookup.customer_id IS DISTINCT FROM 'f3f3f3f3-0000-4000-8000-000000000001'
    OR v_lookup.merchant_id IS DISTINCT FROM 'e2e2e2e2-0000-4000-8000-000000000001'
    OR v_lookup.request_fingerprint IS DISTINCT FROM 'wrpc-fp-1'
  THEN
    RAISE EXCEPTION 'K2: owned verdict wrong: %', row_to_json(v_lookup);
  END IF;
END;
$k2$;

-- --- K3: foreign key reveals NOTHING ----------------------------------
DO $k3$
DECLARE
  v_lookup record;
BEGIN
  SELECT * INTO v_lookup
  FROM public.lookup_vtu_idempotency_row(
    'e5e5e5e5-0000-4000-8000-000000000002',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF v_lookup.verdict IS DISTINCT FROM 'foreign'
    OR v_lookup.vtu_transaction_id IS NOT NULL
    OR v_lookup.customer_id IS NOT NULL
    OR v_lookup.merchant_id IS NOT NULL
    OR v_lookup.request_fingerprint IS NOT NULL
  THEN
    RAISE EXCEPTION 'K3: foreign verdict leaks fields: %', row_to_json(v_lookup);
  END IF;
END;
$k3$;

-- --- K4: anon is refused ----------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $k4$
BEGIN
  BEGIN
    PERFORM public.lookup_vtu_idempotency_row(
      'e5e5e5e5-0000-4000-8000-000000000001',
      'b22df000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'K4: anon unexpectedly executed lookup RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: no anon grant.
  END;
END;
$k4$;

-- --- K5: service_role reads any key -----------------------------------
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $k5$
DECLARE
  v_lookup record;
BEGIN
  SELECT * INTO v_lookup
  FROM public.lookup_vtu_idempotency_row(
    'e5e5e5e5-0000-4000-8000-000000000002',
    'b22df000-0000-4000-8000-000000000002'
  );
  IF v_lookup.verdict IS DISTINCT FROM 'owned'
    OR v_lookup.vtu_transaction_id IS DISTINCT FROM 'd4d4d4d4-0000-4000-8000-000000000002'
  THEN
    RAISE EXCEPTION 'K5: service_role lookup wrong: %', row_to_json(v_lookup);
  END IF;
END;
$k5$;

-- --- C1: authenticated owner claim records ----------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true
);

DO $c1$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    'e5e5e5e5-0000-4000-8000-000000000011',
    'wrpc-fp-claim-1',
    'd4d4d4d4-0000-4000-8000-000000000001',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000001'
  );
  IF NOT FOUND
    OR v_claim.created IS NOT TRUE
    OR v_claim.transaction_id IS DISTINCT FROM 'd4d4d4d4-0000-4000-8000-000000000001'
  THEN
    RAISE EXCEPTION 'C1: owner claim failed: %', row_to_json(v_claim);
  END IF;
END;
$c1$;

-- --- C2: cross-customer claim is scope-mismatched ----------------------
DO $c2$
BEGIN
  BEGIN
    PERFORM public.claim_vtu_intent(
      'e5e5e5e5-0000-4000-8000-000000000012',
      'wrpc-fp-claim-2',
      'd4d4d4d4-0000-4000-8000-000000000002',
      'e2e2e2e2-0000-4000-8000-000000000001',
      'f3f3f3f3-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'C2: cross-customer claim unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'claim_scope_mismatch%' THEN
      RAISE EXCEPTION 'C2: wrong raise: %', SQLERRM;
    END IF;
  END;
END;
$c2$;

-- --- C3: second key for the same scope joins in-flight ----------------
DO $c3$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    'e5e5e5e5-0000-4000-8000-000000000013',
    'wrpc-fp-1',
    'd4d4d4d4-0000-4000-8000-000000000003',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000001'
  );
  IF NOT FOUND
    OR v_claim.created IS NOT FALSE
    OR v_claim.transaction_id IS DISTINCT FROM 'd4d4d4d4-0000-4000-8000-000000000001'
    OR v_claim.idempotency_key IS DISTINCT FROM 'e5e5e5e5-0000-4000-8000-000000000001'
  THEN
    RAISE EXCEPTION 'C3: join failed: %', row_to_json(v_claim);
  END IF;
END;
$c3$;

-- --- C4: service_role claim unchanged (no JWT required) ----------------
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $c4$
DECLARE
  v_claim record;
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    'e5e5e5e5-0000-4000-8000-000000000014',
    'wrpc-fp-claim-4',
    'd4d4d4d4-0000-4000-8000-000000000002',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000002'
  );
  IF NOT FOUND OR v_claim.created IS NOT TRUE THEN
    RAISE EXCEPTION 'C4: service_role claim failed';
  END IF;
END;
$c4$;

-- --- C5: anon claim is forbidden --------------------------------------
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $c5$
BEGIN
  BEGIN
    PERFORM public.claim_vtu_intent(
      'e5e5e5e5-0000-4000-8000-000000000015',
      'wrpc-fp-claim-5',
      'd4d4d4d4-0000-4000-8000-000000000001',
      'e2e2e2e2-0000-4000-8000-000000000001',
      'f3f3f3f3-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'C5: anon claim unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    -- Either the missing grant or the in-function role gate.
    IF SQLSTATE = 'P0001' AND SQLERRM NOT LIKE 'forbidden%' THEN
      RAISE EXCEPTION 'C5: wrong raise: %', SQLERRM;
    END IF;
  END;
END;
$c5$;

-- --- D1: owner fail-orphan deletes the pending row --------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true
);

DO $d1$
DECLARE
  v_verdict text;
  v_count integer;
BEGIN
  v_verdict := public.fail_orphan_vtu_transaction(
    'd4d4d4d4-0000-4000-8000-000000000001',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF v_verdict IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'D1: expected deleted, got %', v_verdict;
  END IF;

  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_count
  FROM public.vtu_transactions
  WHERE id = 'd4d4d4d4-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'D1: row still present';
  END IF;
END;
$d1$;

-- --- D2: repeat call is idempotent ------------------------------------
DO $d2$
DECLARE
  v_verdict text;
BEGIN
  v_verdict := public.fail_orphan_vtu_transaction(
    'd4d4d4d4-0000-4000-8000-000000000001',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF v_verdict IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'D2: expected deleted, got %', v_verdict;
  END IF;
END;
$d2$;

-- NOTE: the marked_failed branch needs a pending row to survive a
-- same-xact delete — reachable only via a concurrent status flip
-- between the RPC's DELETE and re-read, which a single-backend
-- check cannot produce (same testability as the TS version's
-- transport-loss trigger). The route-level mock test covers the
-- 'marked_failed' mapping instead.

-- --- D3: non-pending row is owned elsewhere, untouched ----------------
DO $d3$
DECLARE
  v_verdict text;
  v_status text;
BEGIN
  v_verdict := public.fail_orphan_vtu_transaction(
    'd4d4d4d4-0000-4000-8000-000000000003',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000001'
  );
  IF v_verdict IS DISTINCT FROM 'owned_elsewhere' THEN
    RAISE EXCEPTION 'D3: expected owned_elsewhere, got %', v_verdict;
  END IF;

  SET LOCAL ROLE service_role;
  SELECT status INTO v_status
  FROM public.vtu_transactions
  WHERE id = 'd4d4d4d4-0000-4000-8000-000000000003';
  SET LOCAL ROLE authenticated;
  IF v_status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'D3: live row clobbered to %', v_status;
  END IF;
END;
$d3$;

-- --- D4: foreign transaction is refused -------------------------------
DO $d4$
BEGIN
  BEGIN
    PERFORM public.fail_orphan_vtu_transaction(
      'd4d4d4d4-0000-4000-8000-000000000002',
      'e2e2e2e2-0000-4000-8000-000000000001',
      'b22df000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'D4: foreign fail-orphan unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'not authorized%' THEN
      RAISE EXCEPTION 'D4: wrong raise: %', SQLERRM;
    END IF;
  END;
END;
$d4$;

-- --- D5: anon is refused ----------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $d5$
BEGIN
  BEGIN
    PERFORM public.fail_orphan_vtu_transaction(
      'd4d4d4d4-0000-4000-8000-000000000003',
      'e2e2e2e2-0000-4000-8000-000000000001',
      'b22df000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'D5: anon unexpectedly executed fail-orphan RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: no anon grant.
  END;
END;
$d5$;

-- --- D6: service_role (server callers) works --------------------------
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $d6$
DECLARE
  v_verdict text;
BEGIN
  v_verdict := public.fail_orphan_vtu_transaction(
    'd4d4d4d4-0000-4000-8000-000000000002',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'b22df000-0000-4000-8000-000000000002'
  );
  IF v_verdict IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'D6: expected deleted, got %', v_verdict;
  END IF;
END;
$d6$;

-- --- Grants ------------------------------------------------------------
DO $grants$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.insert_prepared_vtu_transaction(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text, numeric, numeric, numeric, text, text, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on insert_prepared_vtu_transaction';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.lookup_vtu_idempotency_row(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on lookup_vtu_idempotency_row';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_vtu_intent(uuid, text, uuid, uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on claim_vtu_intent';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.fail_orphan_vtu_transaction(uuid, uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on fail_orphan_vtu_transaction';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.insert_prepared_vtu_transaction(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text, numeric, numeric, numeric, text, text, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on insert_prepared_vtu_transaction';
  END IF;
END;
$grants$;

ROLLBACK;
