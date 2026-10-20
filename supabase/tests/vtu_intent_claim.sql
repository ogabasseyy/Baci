-- =====================================================================
-- REGRESSION TEST: claim_vtu_intent (wallet-only exactly-once claim)
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/vtu_intent_claim.sql
--
-- Covers the RPC contract sequentially: create, in-flight join
-- (records exactly the loser-key mapping), terminal overlap fence
-- (the crux: stale terminals excluded so repeats start new,
-- overlapping terminals joined to preserve exactly-once),
-- earliest-wins tie-break, fingerprint/scope mismatch raises,
-- cross-customer/cross-merchant isolation, spent-key idempotence
-- (winner + loser keys), service-role gating + grants.
--
-- NOTE: this file runs in a single session, so it cannot prove
-- two-backend race serialization directly. That rests on
-- pg_advisory_xact_lock semantics (xact-scoped: a waiter's SELECT
-- observes the holder's commit) plus the in-repo
-- complete_order_gateway_payment precedent.
--
-- NOTE: single-transaction tests freeze now(), so overlap-fence
-- orderings are set EXPLICITLY on the claiming created_at
-- (post-dated for stale-terminal repeats, pre-dated for
-- overlapping duplicates) — never rely on statement ordering
-- for created_at/updated_at comparisons. The terminal side is
-- never backdated: the updated_at trigger re-stamps every UPDATE.
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
  v_claim record;
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
  FROM public.claim_vtu_intent(v_k1, 'fp-airtime-500', v_t1, v_m1, v_c1);
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
  FROM public.claim_vtu_intent(v_k2, 'fp-airtime-500', v_t2, v_m1, v_c1);
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
  -- prepare is never joined — the claim starts a new purchase
  -- (repeat purchases share fingerprints). Staleness is explicit
  -- on the claiming created_at: the single-xact clock freezes
  -- now(), and the updated_at trigger re-stamps every UPDATE, so
  -- the terminal's settle time cannot be backdated — the fresh
  -- prepare is post-dated instead (equivalent ordering).
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
  FROM public.claim_vtu_intent(v_k3, 'fp-airtime-500', v_t3, v_m1, v_c1);
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
  FROM public.claim_vtu_intent(v_k4, 'fp-airtime-500', v_t4, v_m1, v_c1);
  IF v_claim.created IS DISTINCT FROM true
    OR v_claim.transaction_id IS DISTINCT FROM v_t4
  THEN
    RAISE EXCEPTION 'Post-failure claim must create (t4), got %', v_claim;
  END IF;

  -- 5. Earliest in-flight mapping wins (pre-deploy drain determinism).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k5, 'fp-tie', v_t5, v_m1, v_c1);
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
  FROM public.claim_vtu_intent(v_k7, 'fp-tie', v_t7, v_m1, v_c1);
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t5
    OR v_claim.idempotency_key IS DISTINCT FROM v_k5
  THEN
    RAISE EXCEPTION 'Tie-break must join earliest (t5/k5), got %', v_claim;
  END IF;

  -- 6. Same key + different fingerprint raises (409 contract).
  BEGIN
    PERFORM public.claim_vtu_intent(v_k5, 'fp-other', v_t8, v_m1, v_c1);
    RAISE EXCEPTION 'Expected claim_fingerprint_mismatch';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_fingerprint_mismatch%' THEN
      RAISE;
    END IF;
  END;

  -- 7. Same key + different scope raises (400 contract).
  BEGIN
    PERFORM public.claim_vtu_intent(v_k5, 'fp-tie', v_t8, v_m1, v_c2);
    RAISE EXCEPTION 'Expected claim_scope_mismatch';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%claim_scope_mismatch%' THEN
      RAISE;
    END IF;
  END;

  -- 8. Same fingerprint under another customer is an independent
  -- intent (isolation is by scope, not fingerprint).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k8, 'fp-airtime-500', v_t9, v_m1, v_c2);
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
  );
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cross-merchant claim must create, got %', v_claim;
  END IF;

  -- 10. Spent-key idempotence: the SAME key always returns its
  -- recorded outcome, even after terminalization (same-key
  -- contract; terminal exclusion applies to cross-key claims).
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k1, 'fp-airtime-500', v_t2, v_m1, v_c1);
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
    PERFORM public.claim_vtu_intent(v_k2, 'fp-gated', v_t2, v_m1, v_c1);
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
    'public.claim_vtu_intent(uuid, text, uuid, uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not have EXECUTE on claim_vtu_intent';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_vtu_intent(uuid, text, uuid, uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must have EXECUTE on claim_vtu_intent';
  END IF;

  -- 13. Overlap fence: a terminal that settled AFTER the claiming
  -- transaction was prepared joins (same in-flight operation — a
  -- concurrent duplicate delayed in preparation must not debit
  -- twice). The claimant prepare is explicitly pre-dated.
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
  FROM public.claim_vtu_intent(v_k10, 'fp-overlap', v_t10, v_m1, v_c1);
  IF v_claim.created IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Overlap setup claim must create, got %', v_claim;
  END IF;
  UPDATE public.vtu_transactions SET status = 'successful' WHERE id = v_t10;
  SELECT * INTO v_claim
  FROM public.claim_vtu_intent(v_k11, 'fp-overlap', v_t11, v_m1, v_c1);
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
  FROM public.claim_vtu_intent(v_k2, 'fp-airtime-500', v_t2, v_m1, v_c1);
  IF v_claim.created IS DISTINCT FROM false
    OR v_claim.transaction_id IS DISTINCT FROM v_t1
    OR v_claim.idempotency_key IS DISTINCT FROM v_k2
  THEN
    RAISE EXCEPTION 'Loser key must replay (t1/k2), got %', v_claim;
  END IF;
END;
$test$;

ROLLBACK;
