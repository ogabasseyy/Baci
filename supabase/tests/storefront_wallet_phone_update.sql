-- =====================================================================
-- REGRESSION TEST: set_customer_wallet_phone
--
-- A signed-in shopper may save the phone number on their own live customer
-- row for one merchant, and nothing else: not another user's row, not a row
-- at another merchant, not a deleted row, and not once a wallet onboarding
-- intent exists for them at that merchant (the provider keeps the details it
-- was first given, so the local copy must stop changing). Denied EXECUTE is
-- asserted via the catalog, never by calling as a role without EXECUTE.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/storefront_wallet_phone_update.sql
-- =====================================================================

BEGIN;

\ir storefront_wallet_profile_fixtures.inc.sql

-- --- Catalog: definer, pinned search_path, exact grants, explicit columns --
DO $catalog$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure(
    'public.set_customer_wallet_phone(uuid,uuid,text)');
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'set_customer_wallet_phone(uuid,uuid,text) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid AND p.prosecdef
      AND p.prorettype = 'jsonb'::regtype
      AND p.proconfig = ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'phone RPC must be SECURITY DEFINER, return jsonb and pin search_path to empty';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the phone RPC';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must not execute the phone RPC';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute the phone RPC';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute the phone RPC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid
      AND (p.prosrc ~* '(to_jsonb|row_to_json)\s*\(' OR p.prosrc ~* '(select|returning)\s+\*')
  ) THEN
    RAISE EXCEPTION 'phone RPC must read and return explicit columns only';
  END IF;
  -- The customer row lock, taken before the intent check, serialises a save
  -- with an onboarding claim. One session cannot observe it, so pin it here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid
      AND p.prosrc ~* 'FOR\s+NO\s+KEY\s+UPDATE\s*;.*piggyvest_primary\.onboarding_intents'
  ) THEN
    RAISE EXCEPTION 'phone RPC must lock the customer row before the intent check';
  END IF;
END;
$catalog$;

-- --- Calls, as signed-in shoppers --------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

DO $calls$
DECLARE
  v_m1 uuid := 'e1f01000-0000-4000-8000-000000000001';
  v_u text := 'e1f00000-0000-4000-8000-0000000000';
  v_result jsonb;
  r record;
BEGIN
  -- Own phone, trimmed and stored as 234 digits (the PiggyVest form); the
  -- caller's verified intent at m2 does not lock m1.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_u || '01', 'role', 'authenticated')::text, true);
  v_result := public.set_customer_wallet_phone(v_m1, (v_u || '01')::uuid, '  08000009901 ');
  IF (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(v_result) k)
    IS DISTINCT FROM ARRAY['date_of_birth', 'email', 'first_name', 'id', 'last_name',
      'loyalty_points', 'phone', 'user_id', 'username', 'username_changed_at'] THEN
    RAISE EXCEPTION 'phone RPC returned unexpected keys: %', v_result;
  END IF;
  IF v_result->>'id' <> 'e1f02000-0000-4000-8000-000000000001'
    OR v_result->>'user_id' <> v_u || '01'
    OR v_result->>'phone' <> '2348000009901'
    OR v_result->>'first_name' <> 'First01'
    OR (v_result->>'loyalty_points')::integer <> 7 THEN
    RAISE EXCEPTION 'own phone save returned %', v_result;
  END IF;

  -- Every format of a number stores the same digits, and saving one's own
  -- number again in any format is not a conflict with oneself.
  FOR r IN
    SELECT * FROM (VALUES
      ('01', '2348000009901', '2348000009901'),
      ('01', '+2348000009901', '2348000009901'),
      ('01', '8000009901', '2348000009901'),
      ('02', '+2348000009902', '2348000009902'),
      ('04', '8000009904', '2348000009904')
    ) AS t(sub, phone, stored)
  LOOP
    PERFORM pg_catalog.set_config('request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_u || r.sub, 'role', 'authenticated')::text, true);
    v_result := public.set_customer_wallet_phone(v_m1, (v_u || r.sub)::uuid, r.phone);
    IF v_result->>'phone' IS DISTINCT FROM r.stored THEN
      RAISE EXCEPTION 'phone save % for % returned %', r.phone, r.sub, v_result;
    END IF;
  END LOOP;
  -- A company customer may save a phone too.
  IF v_result->>'first_name' IS NOT NULL THEN
    RAISE EXCEPTION 'company customer phone save returned %', v_result;
  END IF;
END;
$calls$;

-- --- Refusals ------------------------------------------------------------
DO $refusals$
DECLARE
  v_m1 uuid := 'e1f01000-0000-4000-8000-000000000001';
  v_m2 uuid := 'e1f01000-0000-4000-8000-000000000002';
  v_m3 uuid := 'e1f01000-0000-4000-8000-000000000003';
  v_u text := 'e1f00000-0000-4000-8000-0000000000';
  v_got text;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('no session', NULL, v_m1, '01', '08000009911', '42501:customer_identity_unavailable'),
      ('another identity', '01', v_m1, '02', '08000009911', '42501:customer_identity_unavailable'),
      ('no expected identity', '01', v_m1, NULL, '08000009911', '42501:customer_identity_unavailable'),
      ('merchant without a row', '01', v_m3, '01', '08000009911', '42501:customer_profile_unavailable'),
      ('no merchant', '01', NULL, '01', '08000009911', '42501:customer_profile_unavailable'),
      ('deleted customer', '03', v_m1, '03', '08000009911', '42501:customer_profile_unavailable'),
      ('letters', '01', v_m1, '01', 'invalid', '22023:invalid_wallet_phone'),
      ('empty', '01', v_m1, '01', '', '22023:invalid_wallet_phone'),
      ('blank', '01', v_m1, '01', '   ', '22023:invalid_wallet_phone'),
      ('null', '01', v_m1, '01', NULL, '22023:invalid_wallet_phone'),
      ('too short', '01', v_m1, '01', '080000099', '22023:invalid_wallet_phone'),
      ('too long', '01', v_m1, '01', '0800000991100000', '22023:invalid_wallet_phone'),
      ('too long once canonical', '01', v_m1, '01', '080000099110000', '22023:invalid_wallet_phone'),
      ('inner spaces', '01', v_m1, '01', '+234 800 000 9911', '22023:invalid_wallet_phone'),
      ('double plus', '01', v_m1, '01', '++2348000009911', '22023:invalid_wallet_phone'),
      ('control character', '01', v_m1, '01', E'0800000\n9911', '22023:invalid_wallet_phone'),
      ('held by another customer', '01', v_m1, '01', '08000000105', '23505:wallet_phone_unavailable'),
      ('held as 0, saved as +234', '01', v_m1, '01', '+2348000000105', '23505:wallet_phone_unavailable'),
      ('held as 0, saved as 234', '01', v_m1, '01', '2348000000105', '23505:wallet_phone_unavailable'),
      ('held as +234, saved as 0', '01', v_m1, '01', '08000000113', '23505:wallet_phone_unavailable'),
      ('held as 234, saved bare', '01', v_m1, '01', '8000000114', '23505:wallet_phone_unavailable'),
      ('held by a deleted customer', '01', v_m1, '01', '+2348000000103', '23505:wallet_phone_unavailable'),
      ('dispatched intent', '05', v_m1, '05', '08000009911', '55000:wallet_profile_locked'),
      ('unknown intent', '06', v_m1, '06', '08000009911', '55000:wallet_profile_locked'),
      ('accepted intent', '07', v_m1, '07', '08000009911', '55000:wallet_profile_locked'),
      ('verified intent', '08', v_m1, '08', '08000009911', '55000:wallet_profile_locked'),
      ('rejected intent', '09', v_m1, '09', '08000009911', '55000:wallet_profile_locked'),
      ('detached intent', '10', v_m1, '10', '08000009911', '55000:wallet_profile_locked'),
      ('routing pending intent', '12', v_m1, '12', '08000009911', '55000:wallet_profile_locked'),
      ('ownership review intent', '13', v_m1, '13', '08000009911', '55000:wallet_profile_locked'),
      ('routing review intent', '14', v_m1, '14', '08000009911', '55000:wallet_profile_locked'),
      ('intent at that merchant', '01', v_m2, '01', '08000009911', '55000:wallet_profile_locked')
    ) AS t(label, sub, merchant_id, expected_user, phone, expected)
  LOOP
    PERFORM pg_catalog.set_config('request.jwt.claims',
      CASE WHEN r.sub IS NULL THEN '' ELSE pg_catalog.jsonb_build_object(
        'sub', v_u || r.sub, 'role', 'authenticated')::text END, true);
    v_got := NULL;
    BEGIN
      PERFORM public.set_customer_wallet_phone(
        r.merchant_id, (v_u || r.expected_user)::uuid, r.phone);
    EXCEPTION WHEN OTHERS THEN
      v_got := SQLSTATE || ':' || SQLERRM;
    END;
    IF v_got IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'phone refusal (%): expected %, got %',
        r.label, r.expected, COALESCE(v_got, 'success');
    END IF;
  END LOOP;
END;
$refusals$;

-- --- Locked: the number already stored, in any format, is accepted -------
-- and written nowhere (the row version, ctid, stays the same).
DO $locked_same$
DECLARE
  v_m1 uuid := 'e1f01000-0000-4000-8000-000000000001';
  v_u text := 'e1f00000-0000-4000-8000-0000000000';
  v_before tid;
  v_result jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('06', '08000000106', '08000000106'), ('06', '+2348000000106', '08000000106'),
      ('08', ' 2348000000108 ', '08000000108'), ('13', '+2348000000113', '+2348000000113'),
      ('13', '08000000113', '+2348000000113'), ('14', '8000000114', '2348000000114')
    ) AS t(sub, phone, stored)
  LOOP
    PERFORM pg_catalog.set_config('request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', v_u || r.sub, 'role', 'authenticated')::text, true);
    SELECT c.ctid INTO v_before FROM public.customers c
    WHERE c.id = ('e1f02000-0000-4000-8000-0000000000' || r.sub)::uuid;
    v_result := public.set_customer_wallet_phone(v_m1, (v_u || r.sub)::uuid, r.phone);
    IF v_result->>'phone' IS DISTINCT FROM r.stored
      OR v_result->>'id' <> 'e1f02000-0000-4000-8000-0000000000' || r.sub THEN
      RAISE EXCEPTION 'locked same phone % for % returned %', r.phone, r.sub, v_result;
    END IF;
    IF (SELECT c.ctid FROM public.customers c
        WHERE c.id = ('e1f02000-0000-4000-8000-0000000000' || r.sub)::uuid)
      IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'locked same phone % for % rewrote the row', r.phone, r.sub;
    END IF;
  END LOOP;
END;
$locked_same$;

-- --- Only the callers' own rows changed, and only their phone ------------
RESET ROLE;

DO $after$
DECLARE
  v_changed text;
BEGIN
  SELECT pg_catalog.string_agg(c.id::text, ', ' ORDER BY c.id) INTO v_changed
  FROM public.customers c
  JOIN (VALUES
    ('01', '2348000009901'), ('02', '2348000009902'), ('03', '08000000103'),
    ('04', '2348000009904'), ('05', '08000000105'), ('06', '08000000106'),
    ('07', '08000000107'), ('08', '08000000108'), ('09', '08000000109'),
    ('10', '08000000110'), ('11', '08000000111'), ('12', '08000000112'),
    ('13', '+2348000000113'), ('14', '2348000000114')
  ) AS e(n, phone)
    ON c.id = ('e1f02000-0000-4000-8000-0000000000' || e.n)::uuid
  WHERE c.phone IS DISTINCT FROM e.phone
    OR (e.n <> '04' AND (c.first_name IS DISTINCT FROM 'First' || e.n
      OR c.last_name IS DISTINCT FROM 'Last' || e.n));
  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected customer state after phone calls: %', v_changed;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.customers c
      WHERE c.id::text LIKE 'e1f02000-%') <> 14 THEN
    RAISE EXCEPTION 'phone suite fixtures changed size';
  END IF;
END;
$after$;

ROLLBACK;
