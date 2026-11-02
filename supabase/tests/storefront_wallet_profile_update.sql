-- =====================================================================
-- REGRESSION TEST: set_customer_wallet_profile
--
-- A signed-in shopper may save the first and last name on their own live
-- individual customer row for one merchant, and nothing else: not another
-- user's row, not a row at another merchant, not a deleted or company row,
-- and not once a wallet onboarding intent exists for them at that merchant
-- (the provider keeps the details it was first given). Shoppers still cannot
-- read onboarding intents themselves. Denied EXECUTE and table access are
-- asserted via the catalog, never by calling as a role without the grant.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/storefront_wallet_profile_update.sql
-- =====================================================================

BEGIN;

\ir storefront_wallet_profile_fixtures.inc.sql

-- --- Catalog: definer, pinned search_path, exact grants, explicit columns --
DO $catalog$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure(
    'public.set_customer_wallet_profile(uuid,uuid,text,text)');
  v_role text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'set_customer_wallet_profile(uuid,uuid,text,text) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid AND p.prosecdef
      AND p.prorettype = 'jsonb'::regtype
      AND p.proconfig = ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'profile RPC must be SECURITY DEFINER, return jsonb and pin search_path to empty';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute the profile RPC';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must not execute the profile RPC';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute the profile RPC';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = v_fn::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute the profile RPC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_fn::oid
      AND (p.prosrc ~* '(to_jsonb|row_to_json)\s*\(' OR p.prosrc ~* '(select|returning)\s+\*')
  ) THEN
    RAISE EXCEPTION 'profile RPC must read and return explicit columns only';
  END IF;
  -- The lock reads onboarding intents inside the definer; shoppers cannot.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_schema_privilege(v_role, 'piggyvest_primary', 'USAGE')
      OR pg_catalog.has_table_privilege(v_role,
        'piggyvest_primary.onboarding_intents', 'SELECT')
      OR pg_catalog.has_any_column_privilege(v_role,
        'piggyvest_primary.onboarding_intents', 'SELECT') THEN
      RAISE EXCEPTION '% must not read onboarding intents', v_role;
    END IF;
  END LOOP;
END;
$catalog$;

-- --- Calls, as signed-in shoppers --------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

DO $calls$
DECLARE
  v_m1 uuid := 'e1f01000-0000-4000-8000-000000000001';
  v_m2 uuid := 'e1f01000-0000-4000-8000-000000000002';
  v_m3 uuid := 'e1f01000-0000-4000-8000-000000000003';
  v_u text := 'e1f00000-0000-4000-8000-0000000000';
  v_100 text := pg_catalog.repeat('a', 100);
  v_result jsonb;
  v_got text;
  r record;
BEGIN
  -- Own names, trimmed; the caller's verified intent at m2 does not lock m1.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_u || '01', 'role', 'authenticated')::text, true);
  v_result := public.set_customer_wallet_profile(
    v_m1, (v_u || '01')::uuid, '  Ada ', ' Okafor  ');
  IF (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(v_result) k)
    IS DISTINCT FROM ARRAY['date_of_birth', 'email', 'first_name', 'id', 'last_name',
      'loyalty_points', 'phone', 'user_id', 'username', 'username_changed_at'] THEN
    RAISE EXCEPTION 'profile RPC returned unexpected keys: %', v_result;
  END IF;
  IF v_result->>'id' <> 'e1f02000-0000-4000-8000-000000000001'
    OR v_result->>'first_name' <> 'Ada' OR v_result->>'last_name' <> 'Okafor'
    OR v_result->>'phone' <> '08000000101'
    OR (v_result->>'loyalty_points')::integer <> 7 THEN
    RAISE EXCEPTION 'own names save returned %', v_result;
  END IF;

  -- The longest accepted names: 100 + 99 characters, 200 with the space.
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_u || '02', 'role', 'authenticated')::text, true);
  v_result := public.set_customer_wallet_profile(
    v_m1, (v_u || '02')::uuid, v_100, pg_catalog.repeat('b', 99));
  IF pg_catalog.length(v_result->>'first_name') <> 100
    OR pg_catalog.length(v_result->>'last_name') <> 99 THEN
    RAISE EXCEPTION 'longest names save returned %', v_result;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('no session', NULL, v_m1, '01', 'Ada', 'Okafor', '42501:customer_identity_unavailable'),
      ('another identity', '01', v_m1, '02', 'Ada', 'Okafor', '42501:customer_identity_unavailable'),
      ('no expected identity', '01', v_m1, NULL, 'Ada', 'Okafor', '42501:customer_identity_unavailable'),
      ('merchant without a row', '01', v_m3, '01', 'Ada', 'Okafor', '42501:customer_profile_unavailable'),
      ('no merchant', '01', NULL, '01', 'Ada', 'Okafor', '42501:customer_profile_unavailable'),
      ('deleted customer', '03', v_m1, '03', 'Ada', 'Okafor', '42501:customer_profile_unavailable'),
      ('null first name', '01', v_m1, '01', NULL, 'Okafor', '22023:invalid_wallet_names'),
      ('null last name', '01', v_m1, '01', 'Ada', NULL, '22023:invalid_wallet_names'),
      ('empty first name', '01', v_m1, '01', '', 'Okafor', '22023:invalid_wallet_names'),
      ('blank last name', '01', v_m1, '01', 'Ada', '   ', '22023:invalid_wallet_names'),
      ('first name over 100', '01', v_m1, '01', v_100 || 'a', 'Okafor', '22023:invalid_wallet_names'),
      ('last name over 100', '01', v_m1, '01', 'Ada', v_100 || 'b', '22023:invalid_wallet_names'),
      ('full name over 200', '01', v_m1, '01', v_100, v_100, '22023:invalid_wallet_names'),
      ('tab in a name', '01', v_m1, '01', E'Ada\tB', 'Okafor', '22023:invalid_wallet_names'),
      ('newline in a name', '01', v_m1, '01', 'Ada', E'Oka\nfor', '22023:invalid_wallet_names'),
      ('company customer', '04', v_m1, '04', 'Ada', 'Okafor', '55000:wallet_profile_individual_only'),
      ('dispatched intent', '05', v_m1, '05', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('unknown intent', '06', v_m1, '06', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('accepted intent', '07', v_m1, '07', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('verified intent', '08', v_m1, '08', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('rejected intent', '09', v_m1, '09', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('detached intent', '10', v_m1, '10', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('routing pending intent', '12', v_m1, '12', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('ownership review intent', '13', v_m1, '13', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('routing review intent', '14', v_m1, '14', 'Ada', 'Okafor', '55000:wallet_profile_locked'),
      ('intent at that merchant', '01', v_m2, '01', 'Ada', 'Okafor', '55000:wallet_profile_locked')
    ) AS t(label, sub, merchant_id, expected_user, first_name, last_name, expected)
  LOOP
    PERFORM pg_catalog.set_config('request.jwt.claims',
      CASE WHEN r.sub IS NULL THEN '' ELSE pg_catalog.jsonb_build_object(
        'sub', v_u || r.sub, 'role', 'authenticated')::text END, true);
    v_got := NULL;
    BEGIN
      PERFORM public.set_customer_wallet_profile(
        r.merchant_id, (v_u || r.expected_user)::uuid, r.first_name, r.last_name);
    EXCEPTION WHEN OTHERS THEN
      v_got := SQLSTATE || ':' || SQLERRM;
    END;
    IF v_got IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'profile refusal (%): expected %, got %',
        r.label, r.expected, COALESCE(v_got, 'success');
    END IF;
  END LOOP;
END;
$calls$;

-- --- Only the callers' own rows changed, and only their names ------------
RESET ROLE;

DO $after$
DECLARE
  v_changed text;
BEGIN
  SELECT pg_catalog.string_agg(c.id::text, ', ' ORDER BY c.id) INTO v_changed
  FROM public.customers c
  JOIN (VALUES
    ('01', 'Ada', 'Okafor', 'Ada Okafor'),
    ('02', pg_catalog.repeat('a', 100), pg_catalog.repeat('b', 99),
      pg_catalog.repeat('a', 100) || ' ' || pg_catalog.repeat('b', 99)),
    ('03', 'First03', 'Last03', 'First03 Last03'),
    ('04', NULL, NULL, 'SWP Company Ltd'),
    ('05', 'First05', 'Last05', 'First05 Last05'),
    ('06', 'First06', 'Last06', 'First06 Last06'),
    ('07', 'First07', 'Last07', 'First07 Last07'),
    ('08', 'First08', 'Last08', 'First08 Last08'),
    ('09', 'First09', 'Last09', 'First09 Last09'),
    ('10', 'First10', 'Last10', 'First10 Last10'),
    ('11', 'First11', 'Last11', 'First11 Last11'),
    ('12', 'First12', 'Last12', 'First12 Last12'),
    ('13', 'First13', 'Last13', 'First13 Last13'),
    ('14', 'First14', 'Last14', 'First14 Last14')
  ) AS e(n, first_name, last_name, full_name)
    ON c.id = ('e1f02000-0000-4000-8000-0000000000' || e.n)::uuid
  WHERE c.first_name IS DISTINCT FROM e.first_name
    OR c.last_name IS DISTINCT FROM e.last_name
    OR c.full_name IS DISTINCT FROM e.full_name
    OR c.phone IS DISTINCT FROM '080000001' || e.n;
  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected customer state after profile calls: %', v_changed;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.customers c
      WHERE c.id::text LIKE 'e1f02000-%') <> 14 THEN
    RAISE EXCEPTION 'profile suite fixtures changed size';
  END IF;
END;
$after$;

ROLLBACK;
