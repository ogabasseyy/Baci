-- =====================================================================
-- REGRESSION TEST: wallet-only checkout RLS boundary, part 1
-- (replay binding RPC, write default-deny, customer find/link RPCs,
-- settings projection RPC) — epic #3694 Phase 2.
--
-- NOTE: an earlier revision exposed a buyer SELECT policy on
-- vtu_transactions; Codex P1 (PR #3741) showed it reopens the
-- full-row exposure that 20261012235000 deliberately removed.
-- There is NO buyer SELECT policy: direct reads see zero rows
-- (P1/P2) and the replay binding goes through the 4-column
-- get_vtu_replay_binding RPC (B1/B2).
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/vtu_checkout_rls.sql
--
-- Part 2 (prepare-insert, idempotency lookup, claim hardening,
-- orphan-fail RPCs) lives in vtu_checkout_write_rpcs.sql.
--
-- Conventions mirror vtu_intent_claim.sql: single txn, fixed UUID
-- fixtures, JWT mocked via request.jwt.claim.* + SET LOCAL ROLE.
-- auth.users seeds use the RESET ROLE pattern (service_role holds
-- no auth.users grant) from blog_media_tombstone_sweep_claim.sql.
-- =====================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_m1 uuid := 'e1e1e1e1-0000-4000-8000-000000000001';
  v_m2 uuid := 'e1e1e1e1-0000-4000-8000-000000000002';
  v_u1 uuid := 'a11ce000-0000-4000-8000-000000000001';
  v_u2 uuid := 'a11ce000-0000-4000-8000-000000000002';
  v_u3 uuid := 'a11ce000-0000-4000-8000-000000000003';
  v_u4 uuid := 'a11ce000-0000-4000-8000-000000000004';
  v_u5 uuid := 'a11ce000-0000-4000-8000-000000000005';
  v_u6 uuid := 'a11ce000-0000-4000-8000-000000000006';
  v_u7 uuid := 'a11ce000-0000-4000-8000-000000000007';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_m1, 'rls-m1@example.com', 'RLS M1', 'rls-m1'),
    (v_m2, 'rls-m2@example.com', 'RLS M2', 'rls-m2');

  -- auth.users seeds run as the session role (see file docblock).
  RESET ROLE;
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, phone, phone_confirmed_at, is_sso_user,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u1@example.com', 'test', now(), NULL, NULL, false,
     now(), now(), '{}', '{}'),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u2@example.com', 'test', now(), NULL, NULL, false,
     now(), now(), '{}', '{}'),
    (v_u3, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u3@example.com', 'test', now(), NULL, NULL, false,
     now(), now(), '{}', '{}'),
    -- u4: UNVERIFIED email (must never link or resolve by email).
    (v_u4, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u4@example.com', 'test', NULL, NULL, NULL, false,
     now(), now(), '{}', '{}'),
    -- u5: phone-verified session carrying an UNVERIFIED address.
    (v_u5, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u5@example.com', 'test', NULL,
     '+2348000000005', now(), false, now(), now(), '{}', '{}'),
    (v_u6, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-linkable@example.com', 'test', now(), NULL, NULL, false,
     now(), now(), '{}', '{}'),
    -- u7: verified SSO account squatting on u2's address. gotrue enforces
    -- users_email_partial_key (unique email where is_sso_user = false), so
    -- only an SSO row can coexist on u2's address.
    (v_u7, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'rls-u2@example.com', 'test', now(), NULL, NULL, true,
     now(), now(), '{}', '{}');
  SET LOCAL ROLE service_role;

  INSERT INTO public.customers (id, merchant_id, email, user_id)
  VALUES
    ('f2f2f2f2-0000-4000-8000-000000000001', v_m1, 'rls-u1@example.com', v_u1),
    ('f2f2f2f2-0000-4000-8000-000000000002', v_m1, 'rls-u2@example.com', v_u2),
    ('f2f2f2f2-0000-4000-8000-000000000003', v_m2, 'rls-u3@example.com', v_u3),
    ('f2f2f2f2-0000-4000-8000-000000000004', v_m1, 'rls-u4@example.com', NULL),
    ('f2f2f2f2-0000-4000-8000-000000000005', v_m1, 'rls-u5@example.com', NULL),
    ('f2f2f2f2-0000-4000-8000-000000000006', v_m1, 'rls-linkable@example.com', NULL);

  INSERT INTO public.vtu_transactions (
    id, merchant_id, customer_id, type, network_provider,
    phone_number, amount, request_reference, status
  )
  VALUES
    ('c3c3c3c3-0000-4000-8000-000000000001', v_m1,
     'f2f2f2f2-0000-4000-8000-000000000001', 'airtime', 'mtn',
     '08030000001', 500, 'RLS-001', 'pending'),
    ('c3c3c3c3-0000-4000-8000-000000000002', v_m1,
     'f2f2f2f2-0000-4000-8000-000000000002', 'airtime', 'mtn',
     '08030000002', 500, 'RLS-002', 'pending'),
    ('c3c3c3c3-0000-4000-8000-000000000003', v_m2,
     'f2f2f2f2-0000-4000-8000-000000000003', 'airtime', 'mtn',
     '08030000003', 700, 'RLS-003', 'successful');

  -- trigger_create_merchant_feature_settings already inserted a default row
  -- for v_m1; upsert the VTU-relevant columns.
  INSERT INTO public.merchant_feature_settings (
    merchant_id, vtu_enabled, vtu_airtime_enabled, vtu_data_enabled,
    vtu_electricity_enabled, vtu_tv_enabled, vtu_betting_enabled,
    vtu_merchant_commission_rate, vtu_customer_cashback_enabled,
    vtu_customer_cashback_rate, paystack_enabled, korapay_enabled
  )
  VALUES (
    v_m1, true, true, false, true, false, false,
    50, true, 10, true, false
  )
  ON CONFLICT (merchant_id) DO UPDATE SET
    vtu_enabled = EXCLUDED.vtu_enabled,
    vtu_airtime_enabled = EXCLUDED.vtu_airtime_enabled,
    vtu_data_enabled = EXCLUDED.vtu_data_enabled,
    vtu_electricity_enabled = EXCLUDED.vtu_electricity_enabled,
    vtu_tv_enabled = EXCLUDED.vtu_tv_enabled,
    vtu_betting_enabled = EXCLUDED.vtu_betting_enabled,
    vtu_merchant_commission_rate = EXCLUDED.vtu_merchant_commission_rate,
    vtu_customer_cashback_enabled = EXCLUDED.vtu_customer_cashback_enabled,
    vtu_customer_cashback_rate = EXCLUDED.vtu_customer_cashback_rate,
    paystack_enabled = EXCLUDED.paystack_enabled,
    korapay_enabled = EXCLUDED.korapay_enabled;
END;
$fixtures$;

-- --- P1: buyer direct SELECT sees nothing (default-deny) ------------
-- No buyer SELECT policy exists by design (Codex P1): even own
-- rows are invisible to direct reads; the binding RPC below is the
-- only owned-row read path.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000001', true
);

DO $p1$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.vtu_transactions
  WHERE id = 'c3c3c3c3-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P1: buyer direct SELECT must see zero rows (saw %)', v_count;
  END IF;
END;
$p1$;

-- --- P2: buyer cannot see other customers' transactions ---------------
DO $p2$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.vtu_transactions
  WHERE id IN (
    'c3c3c3c3-0000-4000-8000-000000000002',
    'c3c3c3c3-0000-4000-8000-000000000003'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P2: buyer must not see foreign transactions (saw %)', v_count;
  END IF;
END;
$p2$;

-- --- B1: binding RPC returns the owned row (4 columns exactly) --------
DO $b1$
DECLARE
  v_bound record;
BEGIN
  SELECT * INTO v_bound
  FROM public.get_vtu_replay_binding(
    'c3c3c3c3-0000-4000-8000-000000000001'
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B1: binding RPC returned zero rows for the owned transaction';
  END IF;
  IF v_bound.id IS DISTINCT FROM 'c3c3c3c3-0000-4000-8000-000000000001'
    OR v_bound.customer_id IS DISTINCT FROM 'f2f2f2f2-0000-4000-8000-000000000001'
    OR v_bound.merchant_id IS DISTINCT FROM 'e1e1e1e1-0000-4000-8000-000000000001'
    OR v_bound.status IS DISTINCT FROM 'pending'
    OR (SELECT count(*) FROM jsonb_object_keys(row_to_json(v_bound)::jsonb)) <> 4
  THEN
    RAISE EXCEPTION 'B1: binding projection wrong: %', row_to_json(v_bound);
  END IF;
END;
$b1$;

-- --- B2: binding RPC hides foreign and missing rows -------------------
DO $b2$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.get_vtu_replay_binding(
    'c3c3c3c3-0000-4000-8000-000000000002'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B2: binding RPC leaked a foreign row';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_vtu_replay_binding(
    'c3c3c3c3-0000-4000-8000-000000000099'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B2: binding RPC returned a row for a missing id';
  END IF;
END;
$b2$;

-- --- P3: anon sees nothing --------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $p3$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.vtu_transactions
  WHERE request_reference LIKE 'RLS-%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P3: anon must see no transactions (saw %)', v_count;
  END IF;
END;
$p3$;

-- --- P4: authenticated INSERT is rejected (default-deny) --------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000001', true
);

DO $p4$
BEGIN
  BEGIN
    INSERT INTO public.vtu_transactions (
      merchant_id, customer_id, type, network_provider,
      phone_number, amount, request_reference
    )
    VALUES (
      'e1e1e1e1-0000-4000-8000-000000000001',
      'f2f2f2f2-0000-4000-8000-000000000001',
      'airtime', 'mtn', '08030000009', 100, 'RLS-FORGE-001'
    );
    RAISE EXCEPTION 'P4: authenticated INSERT unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: no buyer INSERT policy.
  END;
END;
$p4$;

-- --- P5/P6: UPDATE/DELETE match zero rows (no policy, silent) ---------
DO $p5p6$
DECLARE
  v_rows integer;
  v_status text;
BEGIN
  UPDATE public.vtu_transactions
  SET status = 'failed'
  WHERE id = 'c3c3c3c3-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'P5: authenticated UPDATE unexpectedly matched % rows', v_rows;
  END IF;

  DELETE FROM public.vtu_transactions
  WHERE id = 'c3c3c3c3-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'P6: authenticated DELETE unexpectedly matched % rows', v_rows;
  END IF;

  -- Direct SELECT sees nothing (no buyer policy); confirm the row
  -- is unmutated through the binding RPC instead.
  SELECT status INTO v_status
  FROM public.get_vtu_replay_binding(
    'c3c3c3c3-0000-4000-8000-000000000001'
  );
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'P5/P6: own row mutated to %', v_status;
  END IF;
END;
$p5p6$;

-- --- F1: find by user_id ----------------------------------------------
DO $f1$
DECLARE
  v_found uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000001'
  );
  IF v_found IS DISTINCT FROM 'f2f2f2f2-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'F1: byUserId find returned %', v_found;
  END IF;
END;
$f1$;

-- --- F2: find verified-email unlinked row WITHOUT linking -------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000006', true
);

DO $f2$
DECLARE
  v_found uuid;
  v_user_id uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000006'
  );
  IF v_found IS DISTINCT FROM 'f2f2f2f2-0000-4000-8000-000000000006' THEN
    RAISE EXCEPTION 'F2: email find returned %', v_found;
  END IF;

  SET LOCAL ROLE service_role;
  SELECT user_id INTO v_user_id
  FROM public.customers
  WHERE id = 'f2f2f2f2-0000-4000-8000-000000000006';
  SET LOCAL ROLE authenticated;
  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'F2: find must not link (user_id now %)', v_user_id;
  END IF;
END;
$f2$;

-- --- F3: unverified email resolves to null ----------------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000004', true
);

DO $f3$
DECLARE
  v_found uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000004'
  );
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'F3: unverified email must resolve null (got %)', v_found;
  END IF;
END;
$f3$;

-- --- F4: phone session + unverified email resolves to null ------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000005', true
);

DO $f4$
DECLARE
  v_found uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000005'
  );
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'F4: phone session with unverified email must resolve null (got %)', v_found;
  END IF;
END;
$f4$;

-- --- F5: email row linked to a DIFFERENT user resolves to null --------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000007', true
);

DO $f5$
DECLARE
  v_found uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000007'
  );
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'F5: squatter email must resolve null (got %)', v_found;
  END IF;
END;
$f5$;

-- --- F6: spoofed p_user_id raises (attack signal, not null) -----------
DO $f6$
BEGIN
  BEGIN
    PERFORM public.find_vtu_customer_for_checkout(
      'e1e1e1e1-0000-4000-8000-000000000001',
      'a11ce000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'F6: spoofed user id unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    -- Expected: JWT sub (u7) <> p_user_id (u1).
    IF SQLERRM NOT LIKE 'not authorized%' THEN
      RAISE EXCEPTION 'F6: wrong raise: %', SQLERRM;
    END IF;
  END;
END;
$f6$;

-- --- F7: no row for this merchant resolves to null --------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000001', true
);

DO $f7$
DECLARE
  v_found uuid;
BEGIN
  v_found := public.find_vtu_customer_for_checkout(
    'e1e1e1e1-0000-4000-8000-000000000002',
    'a11ce000-0000-4000-8000-000000000001'
  );
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'F7: non-member merchant must resolve null (got %)', v_found;
  END IF;
END;
$f7$;

-- --- L1: link claims the unlinked verified-email row ------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000006', true
);

DO $l1$
DECLARE
  v_row record;
  v_user_id uuid;
BEGIN
  SELECT * INTO v_row
  FROM public.link_vtu_customer_by_email(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000006'
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L1: link returned zero rows';
  END IF;
  IF v_row.id IS DISTINCT FROM 'f2f2f2f2-0000-4000-8000-000000000006'
    OR v_row.user_id IS DISTINCT FROM 'a11ce000-0000-4000-8000-000000000006'
    OR v_row.email IS DISTINCT FROM 'rls-linkable@example.com'
  THEN
    RAISE EXCEPTION 'L1: linked row wrong: %', row_to_json(v_row);
  END IF;

  SET LOCAL ROLE service_role;
  SELECT user_id INTO v_user_id
  FROM public.customers
  WHERE id = 'f2f2f2f2-0000-4000-8000-000000000006';
  SET LOCAL ROLE authenticated;
  IF v_user_id IS DISTINCT FROM 'a11ce000-0000-4000-8000-000000000006' THEN
    RAISE EXCEPTION 'L1: user_id not persisted (now %)', v_user_id;
  END IF;
END;
$l1$;

-- --- L2: link is idempotent for the same user -------------------------
DO $l2$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.link_vtu_customer_by_email(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000006'
  );
  IF NOT FOUND
    OR v_row.id IS DISTINCT FROM 'f2f2f2f2-0000-4000-8000-000000000006'
  THEN
    RAISE EXCEPTION 'L2: re-link wrong: %', row_to_json(v_row);
  END IF;
END;
$l2$;

-- --- L3: squatter cannot steal a linked row ---------------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000007', true
);

DO $l3$
DECLARE
  v_row record;
  v_user_id uuid;
BEGIN
  SELECT * INTO v_row
  FROM public.link_vtu_customer_by_email(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000007'
  );
  IF FOUND THEN
    RAISE EXCEPTION 'L3: squatter link must return zero rows (got %)', row_to_json(v_row);
  END IF;

  SET LOCAL ROLE service_role;
  SELECT user_id INTO v_user_id
  FROM public.customers
  WHERE id = 'f2f2f2f2-0000-4000-8000-000000000002';
  SET LOCAL ROLE authenticated;
  IF v_user_id IS DISTINCT FROM 'a11ce000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'L3: victim link stolen (user_id now %)', v_user_id;
  END IF;
END;
$l3$;

-- --- L4/L5: unverified + phone-session emails never link --------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000004', true
);

DO $l4$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.link_vtu_customer_by_email(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000004'
  );
  IF FOUND THEN
    RAISE EXCEPTION 'L4: unverified email must not link (got %)', row_to_json(v_row);
  END IF;
END;
$l4$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000005', true
);

DO $l5$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.link_vtu_customer_by_email(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000005'
  );
  IF FOUND THEN
    RAISE EXCEPTION 'L5: phone session with unverified email must not link (got %)', row_to_json(v_row);
  END IF;
END;
$l5$;

-- --- S1: member gets the allowlisted projection -----------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000001', true
);

DO $s1$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.get_vtu_checkout_settings(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000001'
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'S1: member got zero rows';
  END IF;
  IF v_row.vtu_enabled IS NOT TRUE
    OR v_row.vtu_airtime_enabled IS NOT TRUE
    OR v_row.vtu_data_enabled IS NOT FALSE
    OR v_row.vtu_electricity_enabled IS NOT TRUE
    OR v_row.vtu_tv_enabled IS NOT FALSE
    OR v_row.vtu_betting_enabled IS NOT FALSE
    OR v_row.vtu_merchant_commission_rate IS DISTINCT FROM 50
    OR v_row.vtu_customer_cashback_enabled IS NOT TRUE
    OR v_row.vtu_customer_cashback_rate IS DISTINCT FROM 10
    OR v_row.paystack_enabled IS NOT TRUE
    OR v_row.korapay_enabled IS NOT FALSE
  THEN
    RAISE EXCEPTION 'S1: projection values wrong: %', row_to_json(v_row);
  END IF;
END;
$s1$;

-- --- S2: non-member gets zero rows ------------------------------------
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'a11ce000-0000-4000-8000-000000000003', true
);

DO $s2$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.get_vtu_checkout_settings(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000003'
  );
  IF FOUND THEN
    RAISE EXCEPTION 'S2: non-member must get zero rows';
  END IF;
END;
$s2$;

-- --- S3: member of a merchant with no settings row gets zero rows ----
-- The merchant trigger auto-created a settings row for m2; remove it so
-- S3 exercises the genuinely-missing-row path (JWT sub is still u3).
RESET ROLE;
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = 'e1e1e1e1-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;

DO $s3$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.get_vtu_checkout_settings(
    'e1e1e1e1-0000-4000-8000-000000000002',
    'a11ce000-0000-4000-8000-000000000003'
  );
  IF FOUND THEN
    RAISE EXCEPTION 'S3: missing settings row must yield zero rows';
  END IF;
END;
$s3$;

-- --- S4: anon gets zero rows ------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $s4$
BEGIN
  BEGIN
    PERFORM public.get_vtu_checkout_settings(
      'e1e1e1e1-0000-4000-8000-000000000001',
      'a11ce000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'S4: anon unexpectedly executed settings RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: no anon grant.
  END;
END;
$s4$;

-- --- S5: service_role (server callers) gets the row -------------------
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $s5$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.get_vtu_checkout_settings(
    'e1e1e1e1-0000-4000-8000-000000000001',
    'a11ce000-0000-4000-8000-000000000001'
  );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'S5: service_role got zero rows';
  END IF;
END;
$s5$;

-- --- Grants ------------------------------------------------------------
DO $grants$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.find_vtu_customer_for_checkout(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on find_vtu_customer_for_checkout';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.link_vtu_customer_by_email(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on link_vtu_customer_by_email';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_vtu_checkout_settings(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on get_vtu_checkout_settings';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.find_vtu_customer_for_checkout(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on find_vtu_customer_for_checkout';
  END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated',
    'public._vtu_checkout_caller_customer(uuid, uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'helper _vtu_checkout_caller_customer must be confined (no authenticated grant)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_vtu_replay_binding(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on get_vtu_replay_binding';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_vtu_replay_binding(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must NOT have EXECUTE on get_vtu_replay_binding';
  END IF;
END;
$grants$;

ROLLBACK;
