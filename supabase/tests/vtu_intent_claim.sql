-- =====================================================================
-- REGRESSION TEST: claim_vtu_intent (wallet-only exactly-once claim)
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/vtu_intent_claim.sql
--
-- Covers the RPC contract sequentially: create, in-flight join
-- (records exactly the loser-key mapping), admission-fenced
-- terminal overlap (the crux: terminals settled before admission
-- excluded so repeats start new, overlapping terminals joined to
-- preserve exactly-once — including commit-skewed terminals proven
-- live at admission by the liveness snapshot; legacy NULL-stamp
-- terminals definitively stale), earliest-wins tie-break,
-- fingerprint/scope mismatch raises, cross-customer/cross-merchant
-- isolation, spent-key idempotence (winner + loser keys),
-- service-role gating + grants, admission-proof requirement.
--
-- NOTE: this file runs in a single session; two-backend race
-- serialization is proven separately by
-- supabase/tests/vtu_intent_claim_concurrency.sql (two live dblink
-- sessions: exactly one creates, the other blocks on the advisory
-- xact lock and joins the winner).
--
-- NOTE: single-transaction tests freeze now(), so overlap-fence
-- orderings are set EXPLICITLY on the p_admitted_at argument
-- (post-dated for stale-terminal repeats, pre-dated for
-- overlapping duplicates) — never rely on statement ordering
-- for timestamp comparisons. The terminal side is never
-- backdated: the updated_at trigger re-stamps every UPDATE.
-- =====================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_m1 uuid := 'a1a1a1a1-0000-4000-8000-000000000001';
  v_m2 uuid := 'a1a1a1a1-0000-4000-8000-000000000002';
  v_c1 uuid := 'b2b2b2b2-0000-4000-8000-000000000001';
  v_c2 uuid := 'b2b2b2b2-0000-4000-8000-000000000002';
  v_c3 uuid := 'b2b2b2b2-0000-4000-8000-000000000003';
  v_t1 uuid := 'c3c3c3c3-0000-4000-8000-000000000001';
  v_t2 uuid := 'c3c3c3c3-0000-4000-8000-000000000002';
  v_t3 uuid := 'c3c3c3c3-0000-4000-8000-000000000003';
  v_t4 uuid := 'c3c3c3c3-0000-4000-8000-000000000004';
  v_t5 uuid := 'c3c3c3c3-0000-4000-8000-000000000005';
  v_t6 uuid := 'c3c3c3c3-0000-4000-8000-000000000006';
  v_t7 uuid := 'c3c3c3c3-0000-4000-8000-000000000007';
  v_t8 uuid := 'c3c3c3c3-0000-4000-8000-000000000008';
  v_t9 uuid := 'c3c3c3c3-0000-4000-8000-000000000009';
  v_t10 uuid := 'c3c3c3c3-0000-4000-8000-000000000011';
  v_t11 uuid := 'c3c3c3c3-0000-4000-8000-000000000012';
  v_t12 uuid := 'c3c3c3c3-0000-4000-8000-000000000013';
  v_t13 uuid := 'c3c3c3c3-0000-4000-8000-000000000014';
  v_t14 uuid := 'c3c3c3c3-0000-4000-8000-000000000015';
  v_t15 uuid := 'c3c3c3c3-0000-4000-8000-000000000016';
  v_t16 uuid := 'c3c3c3c3-0000-4000-8000-000000000017';
  v_t17 uuid := 'c3c3c3c3-0000-4000-8000-000000000018';
  v_t18 uuid := 'c3c3c3c3-0000-4000-8000-000000000019';
  v_t19 uuid := 'c3c3c3c3-0000-4000-8000-000000000020';
  v_t20 uuid := 'c3c3c3c3-0000-4000-8000-000000000021';
  v_t21 uuid := 'c3c3c3c3-0000-4000-8000-000000000022';
  v_t22 uuid := 'c3c3c3c3-0000-4000-8000-000000000023';
  v_k1 uuid := 'd4d4d4d4-0000-4000-8000-000000000001';
  v_k2 uuid := 'd4d4d4d4-0000-4000-8000-000000000002';
  v_k3 uuid := 'd4d4d4d4-0000-4000-8000-000000000003';
  v_k4 uuid := 'd4d4d4d4-0000-4000-8000-000000000004';
  v_k5 uuid := 'd4d4d4d4-0000-4000-8000-000000000005';
  v_k6 uuid := 'd4d4d4d4-0000-4000-8000-000000000006';
  v_k7 uuid := 'd4d4d4d4-0000-4000-8000-000000000007';
  v_k8 uuid := 'd4d4d4d4-0000-4000-8000-000000000008';
  v_k9 uuid := 'd4d4d4d4-0000-4000-8000-000000000009';
  v_k10 uuid := 'd4d4d4d4-0000-4000-8000-000000000010';
  v_k11 uuid := 'd4d4d4d4-0000-4000-8000-000000000011';
  v_k12 uuid := 'd4d4d4d4-0000-4000-8000-000000000012';
  v_k13 uuid := 'd4d4d4d4-0000-4000-8000-000000000013';
  v_k14 uuid := 'd4d4d4d4-0000-4000-8000-000000000014';
  v_k15 uuid := 'd4d4d4d4-0000-4000-8000-000000000015';
  v_k16 uuid := 'd4d4d4d4-0000-4000-8000-000000000016';
  v_k17 uuid := 'd4d4d4d4-0000-4000-8000-000000000017';
  v_k18 uuid := 'd4d4d4d4-0000-4000-8000-000000000018';
  v_k19 uuid := 'd4d4d4d4-0000-4000-8000-000000000019';
  v_k20 uuid := 'd4d4d4d4-0000-4000-8000-000000000020';
  v_k21 uuid := 'd4d4d4d4-0000-4000-8000-000000000021';
  v_k22 uuid := 'd4d4d4d4-0000-4000-8000-000000000022';
  v_k22b uuid := 'd4d4d4d4-0000-4000-8000-00000000002b';
  v_claim record;
  v_proof record;
  v_raised boolean;
  v_rows_before integer;
  v_rows_after integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'intent-claim-m1@example.com', 'Intent Claim M1', 'intent-claim-m1'),
    (v_m2, 'intent-claim-m2@example.com', 'Intent Claim M2', 'intent-claim-m2');

  INSERT INTO public.customers (id, merchant_id, email)
  VALUES
    (v_c1, v_m1, 'intent-claim-c1@example.com'),
    (v_c2, v_m1, 'intent-claim-c2@example.com'),
    (v_c3, v_m2, 'intent-claim-c3@example.com');

  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES
    (v_t1, v_m1, v_c1, 'airtime', 'mtn', '08030000001', 500, 'INTENT-CLAIM-001'),
    (v_t2, v_m1, v_c1, 'airtime', 'mtn', '08030000001', 500, 'INTENT-CLAIM-002'),
    (v_t5, v_m1, v_c1, 'airtime', 'mtn', '08030000002', 500, 'INTENT-CLAIM-005'),
    (v_t6, v_m1, v_c1, 'airtime', 'mtn', '08030000002', 500, 'INTENT-CLAIM-006'),
    (v_t7, v_m1, v_c1, 'airtime', 'mtn', '08030000002', 500, 'INTENT-CLAIM-007'),
    (v_t8, v_m1, v_c1, 'airtime', 'mtn', '08030000003', 700, 'INTENT-CLAIM-008'),
    (v_t9, v_m1, v_c2, 'airtime', 'mtn', '08030000001', 500, 'INTENT-CLAIM-009');

  -- 1. First claim for a scope records the mapping.
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k1, 'fp-airtime-500', v_t1, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t1
    OR v_claim.idempotency_key IS DISTINCT FROM v_k1
  THEN
    RAISE EXCEPTION 'First claim must create (t1/k1), got %', v_claim;
  END IF;

  -- 2. Second key for the same in-flight scope joins the winner
  -- and records exactly ONE row: the loser-key mapping (k2 → t1),
  -- so loser-key retries replay instead of preparing fresh.
  SELECT count(*) INTO v_rows_before FROM public.vtu_idempotency_keys;
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k2, 'fp-airtime-500', v_t2, v_m1, v_c1, now(), '{}');
  SELECT count(*) INTO v_rows_after FROM public.vtu_idempotency_keys;
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t1
    OR v_claim.idempotency_key IS DISTINCT FROM v_k1
  THEN
    RAISE EXCEPTION 'Join must adopt (t1/k1), got %', v_claim;
  END IF;
  IF v_rows_after IS DISTINCT FROM v_rows_before + 1 THEN
    RAISE EXCEPTION 'Join must insert exactly the loser mapping row';
  END IF;
  PERFORM 1
  FROM public.vtu_idempotency_keys
  WHERE key = v_k2
    AND vtu_transaction_id = v_t1
    AND customer_id = v_c1
    AND merchant_id = v_m1
    AND request_fingerprint = 'fp-airtime-500';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join must map loser key k2 to winner t1';
  END IF;

  -- 3. Crux: a transaction that settled BEFORE the claiming
  -- admission is never joined — the claim starts a new purchase
  -- (repeat purchases share fingerprints). Staleness is explicit
  -- on the admission argument: the single-xact clock freezes
  -- now(), and the updated_at trigger re-stamps every UPDATE, so
  -- the terminal's settle time cannot be backdated — the fresh
  -- admission is post-dated instead (equivalent ordering).
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t1;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t3, v_m1, v_c1, 'airtime', 'mtn', '08030000001', 500,
    'INTENT-CLAIM-003', now() + interval '1 hour'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k3, 'fp-airtime-500', v_t3, v_m1, v_c1, now() + interval '1 hour', '{}');
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t3
  THEN
    RAISE EXCEPTION 'Post-success claim must create (t3), got %', v_claim;
  END IF;

  -- 4. Crux: a failed transaction that settled before the prepare
  -- is never joined either (joining would trap retries in a
  -- failure loop — failures rotate keys).
  UPDATE public.vtu_transactions SET status = 'failed' WHERE id = v_t3;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t4, v_m1, v_c1, 'airtime', 'mtn', '08030000001', 500,
    'INTENT-CLAIM-004', now() + interval '1 hour'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k4, 'fp-airtime-500', v_t4, v_m1, v_c1, now() + interval '1 hour', '{}');
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t4
  THEN
    RAISE EXCEPTION 'Post-failure claim must create (t4), got %', v_claim;
  END IF;

  -- 5. Earliest in-flight mapping wins (pre-deploy drain determinism).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k5, 'fp-tie', v_t5, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Tie-break setup claim must create, got %', v_claim;
  END IF;
  UPDATE public.vtu_idempotency_keys
  SET created_at = now() - interval '1 hour'
  WHERE key = v_k5;
  INSERT INTO public.vtu_idempotency_keys (
    key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint
  ) VALUES (v_k6, v_t6, v_c1, v_m1, 'fp-tie');
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k7, 'fp-tie', v_t7, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t5
    OR v_claim.idempotency_key IS DISTINCT FROM v_k5
  THEN
    RAISE EXCEPTION 'Tie-break must join earliest (t5/k5), got %', v_claim;
  END IF;

  -- 6. Same key + different fingerprint raises (409 contract).
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_intent(v_k5, 'fp-other', v_t8, v_m1, v_c1, now(), '{}');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_fingerprint_mismatch%' THEN
      RAISE;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'Test 6: function did not raise the fingerprint-mismatch error';
  END IF;

  -- 7. Same key + different scope raises (400 contract).
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_intent(v_k5, 'fp-tie', v_t8, v_m1, v_c2, now(), '{}');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_scope_mismatch%' THEN
      RAISE;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'Test 7: function did not raise the scope-mismatch error';
  END IF;

  -- 8. Same fingerprint under another customer is an independent
  -- intent (isolation is by scope, not fingerprint).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k8, 'fp-airtime-500', v_t9, v_m1, v_c2, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t9
  THEN
    RAISE EXCEPTION 'Cross-customer claim must create (t9), got %', v_claim;
  END IF;

  -- 9. Same fingerprint under another merchant is independent too.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  ) VALUES (
    'c3c3c3c3-0000-4000-8000-000000000010', v_m2, v_c3, 'airtime',
    'mtn', '08030000001', 500, 'INTENT-CLAIM-010'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k9, 'fp-airtime-500',
    'c3c3c3c3-0000-4000-8000-000000000010', v_m2, v_c3
  , now(), '{}');
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cross-merchant claim must create, got %', v_claim;
  END IF;

  -- 10. Spent-key idempotence: the SAME key always returns its
  -- recorded outcome, even after terminalization (same-key
  -- contract; terminal exclusion applies to cross-key claims).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k1, 'fp-airtime-500', v_t2, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t1
    OR v_claim.idempotency_key IS DISTINCT FROM v_k1
  THEN
    RAISE EXCEPTION 'Spent key must replay (t1/k1), got %', v_claim;
  END IF;

  -- 11. Non-service_role callers are forbidden (in-body gate).
  BEGIN
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.role', 'authenticated', true
    );
    PERFORM public.claim_vtu_intent(v_k2, 'fp-gated', v_t2, v_m1, v_c1, now(), '{}');
    RAISE EXCEPTION 'Expected forbidden for authenticated role';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%requires service_role%' THEN
      RAISE;
    END IF;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'service_role', true
  );

  -- 12. Grants: service_role may execute; authenticated may not.
  IF pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not have EXECUTE on claim_vtu_intent';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must have EXECUTE on claim_vtu_intent';
  END IF;

  -- 13. Overlap fence: a terminal that settled AFTER the claiming
  -- operation was admitted joins (same in-flight operation — a
  -- concurrent duplicate delayed in preparation must not debit
  -- twice). The claimant admission is explicitly pre-dated.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t10, v_m1, v_c1, 'airtime', 'mtn', '08030000004', 500,
    'INTENT-CLAIM-011'
  );
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t11, v_m1, v_c1, 'airtime', 'mtn', '08030000004', 500,
    'INTENT-CLAIM-012', now() - interval '1 hour'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k10, 'fp-overlap', v_t10, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Overlap setup claim must create, got %', v_claim;
  END IF;
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t10;
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k11, 'fp-overlap', v_t11, v_m1, v_c1, now() - interval '1 hour', '{}');
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t10
    OR v_claim.idempotency_key IS DISTINCT FROM v_k10
  THEN
    RAISE EXCEPTION 'Overlapping terminal must join (t10/k10), got %', v_claim;
  END IF;

  -- 14. Spent loser-key idempotence: the loser key recorded by a
  -- join (test 2) replays its mapping like any recorded key —
  -- retries presenting it (restart before canonical adoption,
  -- sibling-tab races) never prepare fresh.
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k2, 'fp-airtime-500', v_t2, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t1
    OR v_claim.idempotency_key IS DISTINCT FROM v_k2
  THEN
    RAISE EXCEPTION 'Loser key must replay (t1/k2), got %', v_claim;
  END IF;

  -- 15. Post-terminal touches must not suppress a legitimate
  -- repeat (Codex R2 P2): (a) the fence reads terminal_at, never
  -- updated_at — simulated settled-at-T1/touched-at-T2 row, with
  -- the repeat prepared between T1 and T2, starts new (an
  -- updated_at fence would wrongly join); (b) the trigger stamps
  -- terminal_at on entry into terminal status; (c) same-status
  -- touches never move terminal_at. Fixed literals (not now())
  -- keep the T1 < prepare < T2 ordering deterministic under the
  -- frozen single-xact clock.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status,
    created_at, updated_at, terminal_at
  )
  VALUES (
    v_t12, v_m1, v_c1, 'airtime', 'mtn', '08030000005', 500,
    'INTENT-CLAIM-013', 'successful',
    '2026-10-01 00:00:00+00', '2026-10-20 04:00:00+00',
    '2026-10-19 12:00:00+00'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k12, 'fp-touch', v_t12, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Touch setup claim must create, got %', v_claim;
  END IF;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t13, v_m1, v_c1, 'airtime', 'mtn', '08030000005', 500,
    'INTENT-CLAIM-014', '2026-10-19 18:00:00+00'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k13, 'fp-touch', v_t13, v_m1, v_c1, '2026-10-19 18:00:00+00', '{}');
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t13
  THEN
    RAISE EXCEPTION 'Post-touch repeat must create (t13), got %', v_claim;
  END IF;
  -- (b) Entry into terminal status stamps terminal_at.
  UPDATE public.vtu_transactions SET status = 'failed' WHERE id = v_t13;
  PERFORM 1
  FROM public.vtu_transactions
  WHERE id = v_t13 AND terminal_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Terminal transition must stamp terminal_at';
  END IF;
  -- (c) Same-status touches never move terminal_at (control value
  -- survives both a non-status update and a metadata touch).
  UPDATE public.vtu_transactions
  SET terminal_at = '2025-06-01 00:00:00+00'
  WHERE id = v_t13;
  UPDATE public.vtu_transactions
  SET error_message = 'touch: post-settlement metadata write'
  WHERE id = v_t13;
  PERFORM 1
  FROM public.vtu_transactions
  WHERE id = v_t13 AND terminal_at = '2025-06-01 00:00:00+00';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Same-status touch must not move terminal_at';
  END IF;

  -- 16. Admission fence (Codex R3 P1): the overlap compares the
  -- terminal time against operation ADMISSION, not row insert. A
  -- duplicate admitted BEFORE the winner settled joins even when
  -- preparation delays its row past terminalization (a row-time
  -- fence would misread the terminal as stale and double-debit).
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t14, v_m1, v_c1, 'airtime', 'mtn', '08030000006', 500,
    'INTENT-CLAIM-015'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k14, 'fp-admit', v_t14, v_m1, v_c1, now(), '{}');
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admit setup claim must create, got %', v_claim;
  END IF;
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t14;
  -- Row inserted AFTER the settle (slow preparation), operation
  -- admitted BEFORE it: must join.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t15, v_m1, v_c1, 'airtime', 'mtn', '08030000006', 500,
    'INTENT-CLAIM-016', now() + interval '1 hour'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k15, 'fp-admit', v_t15, v_m1, v_c1, now() - interval '1 hour', '{}'
  );
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t14
    OR v_claim.idempotency_key IS DISTINCT FROM v_k14
  THEN
    RAISE EXCEPTION 'Pre-settle admission must join (t14/k14), got %', v_claim;
  END IF;

  -- 17. Legacy terminals (terminal_at NULL) are definitively stale
  -- (Codex R3 P2): settled-before-deploy strictly predates any
  -- live admission, so no updated_at fallback may drag them
  -- across the fence — even when a post-migration touch makes
  -- updated_at newer than the claiming admission.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status,
    created_at, updated_at, terminal_at
  )
  VALUES (
    v_t16, v_m1, v_c1, 'airtime', 'mtn', '08030000007', 500,
    'INTENT-CLAIM-017', 'successful',
    '2026-09-01 00:00:00+00', '2026-10-20 04:00:00+00', NULL
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k16, 'fp-legacy', v_t16, v_m1, v_c1, '2026-10-20 03:00:00+00', '{}'
  );
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Legacy setup claim must create, got %', v_claim;
  END IF;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, created_at
  )
  VALUES (
    v_t17, v_m1, v_c1, 'airtime', 'mtn', '08030000007', 500,
    'INTENT-CLAIM-018', '2026-10-20 03:30:00+00'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k17, 'fp-legacy', v_t17, v_m1, v_c1, '2026-10-20 03:30:00+00', '{}'
  );
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t17
  THEN
    RAISE EXCEPTION 'Legacy terminal must stay stale (t17), got %', v_claim;
  END IF;

  -- 18. Missing admission timestamp is rejected: the fence
  -- requires it (no silent fallback to row time).
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_intent(
      v_k17, 'fp-legacy', v_t17, v_m1, v_c1, NULL, '{}'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_invalid_arguments%' THEN
      RAISE;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'Test 18: function did not reject NULL admission';
  END IF;

  -- 19. Admission-liveness join (Codex R4 P1): terminal_at is the
  -- terminal writer's XACT START, not its commit. A winner whose
  -- transaction began before our admission but committed inside
  -- our window carries terminal_at < admitted_at — the stamp fence
  -- alone would exclude it and debit twice. Candidates live at
  -- admission join (same-operation overlap, stamp irrelevant).
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t18, v_m1, v_c1, 'airtime', 'mtn', '08030000008', 500,
    'INTENT-CLAIM-019'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k18, 'fp-live', v_t18, v_m1, v_c1, '2026-10-20 02:30:00+00', '{}'
  );
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Liveness setup claim must create, got %', v_claim;
  END IF;
  -- Terminalize, then skew the stamp before the duplicate's
  -- admission (same-status write: the transition trigger does
  -- not refire — control 15c).
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t18;
  UPDATE public.vtu_transactions
  SET terminal_at = '2026-10-20 02:00:00+00'
  WHERE id = v_t18;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t19, v_m1, v_c1, 'airtime', 'mtn', '08030000008', 500,
    'INTENT-CLAIM-020'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k19, 'fp-live', v_t19, v_m1, v_c1, '2026-10-20 03:00:00+00',
    ARRAY[v_t18]
  );
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t18
    OR v_claim.idempotency_key IS DISTINCT FROM v_k18
  THEN
    RAISE EXCEPTION 'Live-at-admission terminal must join (t18/k18), got %', v_claim;
  END IF;

  -- 20. Liveness negative: a terminal settled before admission and
  -- ABSENT from the live set stays excluded — the snapshot hit
  -- must not over-join genuine repeats.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status,
    created_at, updated_at, terminal_at
  )
  VALUES (
    v_t20, v_m1, v_c1, 'airtime', 'mtn', '08030000009', 500,
    'INTENT-CLAIM-021', 'successful',
    '2026-09-02 00:00:00+00', '2026-09-02 00:00:00+00',
    '2026-09-02 00:00:00+00'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k20, 'fp-stale20', v_t20, v_m1, v_c1, '2026-09-02 00:00:00+00', '{}'
  );
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Stale setup claim must create, got %', v_claim;
  END IF;
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t21, v_m1, v_c1, 'airtime', 'mtn', '08030000009', 500,
    'INTENT-CLAIM-022'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k21, 'fp-stale20', v_t21, v_m1, v_c1, '2026-10-20 03:00:00+00', '{}'
  );
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t21
  THEN
    RAISE EXCEPTION 'Pre-admission terminal outside the live set must stay stale (t21), got %', v_claim;
  END IF;

  -- 21. Missing admission liveness is rejected: the fence
  -- requires it (no silent fallback to the stamp-only fence,
  -- which cannot see commit-skewed terminals).
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_intent(
      v_k1, 'fp-live', v_t1, v_m1, v_c1, now(), NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_invalid_arguments%' THEN
      RAISE;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'Test 21: function did not reject NULL liveness';
  END IF;

  -- 22. Admission proof contract: atomic stamp + live-scope
  -- snapshot by (merchant slug, fingerprint); alias slugs
  -- resolve like the route; unknown slugs yield an empty set
  -- with the stamp (downstream guards reject them as today).
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference
  )
  VALUES (
    v_t22, v_m1, v_c1, 'airtime', 'mtn', '08030000010', 500,
    'INTENT-CLAIM-023'
  );
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k22, 'fp-proof', v_t22, v_m1, v_c1, now(), '{}'
  );
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Proof setup claim must create, got %', v_claim;
  END IF;
  SELECT * INTO v_proof
  FROM public.vtu_admission_proof('intent-claim-m1', 'fp-proof');
  IF v_proof.admitted_at IS NULL
    OR NOT (v_t22 = ANY (v_proof.live_transaction_ids))
  THEN
    RAISE EXCEPTION 'Proof must stamp and list the live mapping, got %', v_proof;
  END IF;
  -- Alias rows grant service_role no INSERT (prod writes go
  -- through rename_merchant_slug), so seed as the session role.
  RESET ROLE;
  INSERT INTO public.merchant_slug_aliases (old_slug, merchant_id)
  VALUES ('intent-claim-old', v_m1);
  SET LOCAL ROLE service_role;
  SELECT * INTO v_proof
  FROM public.vtu_admission_proof('intent-claim-old', 'fp-proof');
  IF NOT (v_t22 = ANY (v_proof.live_transaction_ids)) THEN
    RAISE EXCEPTION 'Proof must resolve alias slugs, got %', v_proof;
  END IF;
  -- A second loser-key join onto the same live transaction must
  -- not duplicate it in the proof (Codex P2): proof size tracks
  -- live transactions, not historical join attempts.
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(
    v_k22b, 'fp-proof', v_t22, v_m1, v_c1, now(), '{}'
  );
  IF v_claim.created IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Second join onto the live mapping must join, got %', v_claim;
  END IF;
  SELECT * INTO v_proof
  FROM public.vtu_admission_proof('intent-claim-m1', 'fp-proof');
  IF coalesce(cardinality(v_proof.live_transaction_ids), -1) <> 1 THEN
    RAISE EXCEPTION 'Proof must dedupe transaction ids, got %', v_proof;
  END IF;
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t22;
  SELECT * INTO v_proof
  FROM public.vtu_admission_proof('intent-claim-m1', 'fp-proof');
  IF v_t22 = ANY (v_proof.live_transaction_ids) THEN
    RAISE EXCEPTION 'Proof must drop terminalized mappings, got %', v_proof;
  END IF;
  SELECT * INTO v_proof
  FROM public.vtu_admission_proof('no-such-store', 'fp-proof');
  IF v_proof.admitted_at IS NULL
    OR coalesce(cardinality(v_proof.live_transaction_ids), -1) <> 0
  THEN
    RAISE EXCEPTION 'Proof on unknown slug must stamp an empty set, got %', v_proof;
  END IF;
END;
$test$;

ROLLBACK;
