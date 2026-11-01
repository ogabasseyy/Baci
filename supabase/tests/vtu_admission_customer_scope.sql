-- #3694: actual admission RPC, verified customer resolver, and claim overlap fence.
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

  -- Claimed rows carry the fully wallet-funded prepare shape
  -- (paymentSplit card=0, wallet=amount): claim_vtu_intent's
  -- funding gate refuses anything else.
  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status, source, metadata
  )
  VALUES
    ('d4d4d4d4-0000-4000-8000-000000000001', v_m1, v_c1, 'airtime', 'mtn',
     '08030000011', 500, 'WRPC-001', 'pending', 'checkout',
     '{"paymentSplit":{"wallet":500,"card":0}}'::jsonb),
    ('d4d4d4d4-0000-4000-8000-000000000002', v_m1, v_c2, 'airtime', 'mtn',
     '08030000012', 500, 'WRPC-002', 'pending', 'checkout',
     '{"paymentSplit":{"wallet":500,"card":0}}'::jsonb),
    ('d4d4d4d4-0000-4000-8000-000000000003', v_m1, v_c1, 'airtime', 'mtn',
     '08030000013', 500, 'WRPC-003', 'processing', 'checkout',
     '{"paymentSplit":{"wallet":500,"card":0}}'::jsonb),
    -- Legacy card/no-split shapes for the C7 funding-gate refusals:
    -- an unpaid card portion must never become a replay mapping.
    ('d4d4d4d4-0000-4000-8000-000000000004', v_m1, v_c1, 'airtime', 'mtn',
     '08030000014', 500, 'WRPC-004', 'pending', 'checkout',
     '{"paymentSplit":{"wallet":0,"card":500}}'::jsonb),
    ('d4d4d4d4-0000-4000-8000-000000000005', v_m1, v_c1, 'airtime', 'mtn',
     '08030000015', 500, 'WRPC-005', 'pending', 'checkout',
     '{}'::jsonb);

  INSERT INTO public.vtu_idempotency_keys (
    key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint
  )
  VALUES
    ('e5e5e5e5-0000-4000-8000-000000000001',
     'd4d4d4d4-0000-4000-8000-000000000001', v_c1, v_m1, 'wrpc-fp-1'),
    ('e5e5e5e5-0000-4000-8000-000000000002',
     'd4d4d4d4-0000-4000-8000-000000000002', v_c2, v_m1, 'wrpc-fp-1');
END;
$fixtures$;
RESET ROLE;
INSERT INTO public.merchant_slug_aliases (merchant_id, old_slug)
VALUES ('e2e2e2e2-0000-4000-8000-000000000001', 'wrpc-old');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true);
DO $test$
DECLARE
  v_proof record;
  v_alias record;
  v_claim record;
BEGIN
  SELECT * INTO v_proof FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_proof.live_transaction_ids IS DISTINCT FROM
    ARRAY['d4d4d4d4-0000-4000-8000-000000000001'::uuid]
    OR v_proof.admitted_at IS DISTINCT FROM statement_timestamp() THEN
    RAISE EXCEPTION 'proof disclosed another customer or lost atomic admission stamp';
  END IF;
  SELECT * INTO v_alias FROM public.vtu_admission_proof('wrpc-old', 'wrpc-fp-1');
  IF v_alias.live_transaction_ids IS DISTINCT FROM v_proof.live_transaction_ids THEN
    RAISE EXCEPTION 'merchant alias lost customer-scoped proof';
  END IF;
  -- Verified guest email resolution matches preparation before linking.
  RESET ROLE;
  UPDATE public.customers SET user_id = NULL
  WHERE id = 'f3f3f3f3-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_alias FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_alias.live_transaction_ids IS DISTINCT FROM v_proof.live_transaction_ids THEN
    RAISE EXCEPTION 'verified unlinked customer lost overlap snapshot';
  END IF;
  RESET ROLE;
  UPDATE auth.users SET email_confirmed_at = NULL
  WHERE id = 'b22df000-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_alias FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_alias.live_transaction_ids IS DISTINCT FROM '{}'::uuid[] THEN
    RAISE EXCEPTION 'unverified email disclosed guest transaction';
  END IF;
  RESET ROLE;
  UPDATE auth.users SET email_confirmed_at = now()
  WHERE id = 'b22df000-0000-4000-8000-000000000001';
  UPDATE public.customers SET user_id = 'b22df000-0000-4000-8000-000000000001'
  WHERE id = 'f3f3f3f3-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  -- Writer terminal stamp predates admission, but this transaction was
  -- live in the snapshot. The claim must join it, never debit a new row.
  RESET ROLE;
  UPDATE public.vtu_transactions SET status = 'successful',
    terminal_at = v_proof.admitted_at - interval '1 hour'
  WHERE id = 'd4d4d4d4-0000-4000-8000-000000000001';
  -- Same-status write pins the old transaction-start stamp even with
  -- the production terminal-transition trigger installed.
  UPDATE public.vtu_transactions SET terminal_at = v_proof.admitted_at - interval '1 hour'
  WHERE id = 'd4d4d4d4-0000-4000-8000-000000000001';
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_claim FROM public.claim_vtu_intent(
    'e5e5e5e5-0000-4000-8000-000000000009', 'wrpc-fp-1',
    'd4d4d4d4-0000-4000-8000-000000000003',
    'e2e2e2e2-0000-4000-8000-000000000001',
    'f3f3f3f3-0000-4000-8000-000000000001',
    v_proof.admitted_at, v_proof.live_transaction_ids
  );
  IF v_claim.created OR v_claim.transaction_id IS DISTINCT FROM
    'd4d4d4d4-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'customer proof lost commit-safe overlap fence';
  END IF;
  SELECT * INTO v_proof FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_proof.live_transaction_ids IS DISTINCT FROM '{}'::uuid[] THEN
    RAISE EXCEPTION 'new admission included terminal/foreign transaction';
  END IF;
END;
$test$;
SELECT set_config('request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000002', true);
DO $second$
DECLARE v_ids uuid[];
BEGIN
  SELECT live_transaction_ids INTO v_ids FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_ids IS DISTINCT FROM ARRAY['d4d4d4d4-0000-4000-8000-000000000002'::uuid] THEN
    RAISE EXCEPTION 'second customer did not receive only own live transaction';
  END IF;
  SELECT live_transaction_ids INTO v_ids FROM public.vtu_admission_proof('wrpc-m2', 'wrpc-fp-1');
  IF v_ids IS DISTINCT FROM '{}'::uuid[] THEN RAISE EXCEPTION 'cross-merchant proof disclosed identifiers'; END IF;
END;
$second$;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $missing$
BEGIN
  BEGIN
    PERFORM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
    RAISE EXCEPTION 'missing uid admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$missing$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
-- Assert the effective anonymous ACL without executing the denied function:
-- the pinned Supabase PostgreSQL image crashes its backend on that permission
-- error. has_function_privilege includes PUBLIC and inherited role grants.
DO $anon$
BEGIN
  IF has_function_privilege(current_user, 'public.vtu_admission_proof(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous admission execute privilege granted';
  END IF;
END;
$anon$;
-- Independently exercise the function's claim guard through a role with
-- EXECUTE. A mismatched anonymous JWT must still be refused internally.
SET LOCAL ROLE authenticated;
-- A valid subject isolates the role check from the separate missing-UID guard.
SELECT set_config('request.jwt.claim.sub', 'b22df000-0000-4000-8000-000000000001', true);
DO $anon_claim$
BEGIN
  BEGIN
    PERFORM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
    RAISE EXCEPTION 'anonymous admission claim accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_claim$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $service$
DECLARE v_ids uuid[];
BEGIN
  SELECT live_transaction_ids INTO v_ids FROM public.vtu_admission_proof('wrpc-m1', 'wrpc-fp-1');
  IF v_ids IS DISTINCT FROM ARRAY['d4d4d4d4-0000-4000-8000-000000000002'::uuid] THEN
    RAISE EXCEPTION 'trusted service compatibility broken';
  END IF;
END;
$service$;
ROLLBACK;
