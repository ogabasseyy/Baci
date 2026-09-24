-- Regression contract for shared Jumia Self Authorization storage.
-- Usage: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/jumia_authorizations_shared.sql

BEGIN;

DO $$
DECLARE
  v_table regclass := to_regclass('public.jumia_authorizations');
  v_function regprocedure := to_regprocedure(
    'public.persist_jumia_self_authorization(uuid,text,text,timestamptz,text[],text[],text[],text[])'
  );
  v_definition text;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'jumia_authorizations table is missing';
  END IF;

  IF v_function IS NULL THEN
    RAISE EXCEPTION 'transactional Jumia persistence function is missing';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF v_definition !~ 'auth.uid\(\)'
    OR v_definition !~ 'check_staff_permission'
    OR v_definition !~ '''integrations'''
    OR v_definition !~ '''manage'''
  THEN
    RAISE EXCEPTION 'Jumia persistence function does not derive caller authority';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    v_function,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers cannot execute Jumia persistence function';
  END IF;

  IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous callers can execute Jumia persistence function';
  END IF;

  IF has_table_privilege('authenticated', v_table, 'INSERT')
    OR has_table_privilege('authenticated', v_table, 'UPDATE')
    OR has_table_privilege('authenticated', v_table, 'DELETE')
  THEN
    RAISE EXCEPTION 'authenticated callers have direct Jumia authorization writes';
  END IF;

  IF has_column_privilege(
    'authenticated',
    v_table,
    'credential_ciphertext',
    'SELECT'
  ) OR has_column_privilege(
    'authenticated',
    v_table,
    'client_key_hash',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated callers can read Jumia credential columns directly';
  END IF;

  IF to_regprocedure(
    'public.find_jumia_authorization_metadata(uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia authorization metadata function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    to_regprocedure('public.find_jumia_authorization_metadata(uuid,text)'),
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    to_regprocedure('public.find_jumia_authorization_metadata(uuid,text)'),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Jumia authorization metadata function privileges are unsafe';
  END IF;

  IF to_regprocedure(
    'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia credential rotation function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers cannot rotate Jumia credentials';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure(
      'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can rotate Jumia credentials';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    to_regprocedure(
      'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role callers cannot rotate Jumia credentials';
  END IF;

  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
    )
  ) INTO v_definition;

  IF v_definition !~ 'auth\.role\(\)'
    OR v_definition !~ 'service_role'
    OR v_definition !~ 'p_expected_rotation_version'
    OR v_definition !~ 'p_refresh_lease_token'
  THEN
    RAISE EXCEPTION 'Jumia credential rotation function lacks worker authorization path';
  END IF;

  IF to_regprocedure(
    'public.claim_jumia_authorization_refresh_lease(uuid,uuid,bigint,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia credential refresh lease function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.claim_jumia_authorization_refresh_lease(uuid,uuid,bigint,integer)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers cannot claim Jumia refresh leases';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure(
      'public.claim_jumia_authorization_refresh_lease(uuid,uuid,bigint,integer)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can claim Jumia refresh leases';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    to_regprocedure(
      'public.claim_jumia_authorization_refresh_lease(uuid,uuid,bigint,integer)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role callers cannot claim Jumia refresh leases';
  END IF;

  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.claim_jumia_authorization_refresh_lease(uuid,uuid,bigint,integer)'
    )
  ) INTO v_definition;

  IF v_definition !~ '''view''' THEN
    RAISE EXCEPTION 'Jumia refresh lease claim does not allow view-authorized staff';
  END IF;

  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.rotate_jumia_authorization_credentials(uuid,text,timestamptz,bigint,uuid)'
    )
  ) INTO v_definition;

  IF v_definition !~ '''view''' THEN
    RAISE EXCEPTION 'Jumia credential rotation does not allow view-authorized staff';
  END IF;

  IF to_regprocedure(
    'public.load_jumia_self_authorization_discovery(uuid,uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia discovery load function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.load_jumia_self_authorization_discovery(uuid,uuid,text)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers cannot load Jumia discovery credentials';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure(
      'public.load_jumia_self_authorization_discovery(uuid,uuid,text)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can load Jumia discovery credentials';
  END IF;

  IF to_regprocedure(
    'public.purge_orphaned_jumia_authorization(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia authorization purge function is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.purge_orphaned_jumia_authorization(uuid,uuid)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers cannot purge orphaned Jumia grants';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure(
      'public.purge_orphaned_jumia_authorization(uuid,uuid)'
    ),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can purge orphaned Jumia grants';
  END IF;

  IF to_regprocedure(
    'public.purge_orphaned_jumia_authorizations()'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia orphan authorization sweep function is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure('public.purge_orphaned_jumia_authorizations()'),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can execute Jumia orphan authorization sweep';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    to_regprocedure('public.purge_orphaned_jumia_authorizations()'),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'worker callers cannot execute Jumia orphan authorization sweep';
  END IF;

  SELECT pg_get_functiondef(
    to_regprocedure('public.purge_orphaned_jumia_authorizations()')
  ) INTO v_definition;

  IF v_definition !~ 'merchant_id = v_candidate\.merchant_id'
    OR v_definition !~ 'shop_id = btrim\(v_candidate\.shop_id\)'
    OR v_definition ~ 'AND platform = ''jumia''\s+AND is_active = false;'
  THEN
    RAISE EXCEPTION 'Jumia orphan sweep does not detach one locked shop at a time';
  END IF;

  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.load_jumia_authorization_credentials(uuid,uuid)'
    )
  ) INTO v_definition;

  IF v_definition !~ '''manage''' THEN
    RAISE EXCEPTION 'Jumia credential loading function does not allow manage-authorized staff';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF v_definition !~ 'unnest\(p_shop_ids, p_marketplace_labels\)'
  THEN
    RAISE EXCEPTION 'Jumia persistence function does not dedupe marketplace-qualified shop selections';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'jumia_authorizations'
      AND policyname = 'jumia_authorizations_select_policy'
      AND qual ~ '''manage'''
  ) THEN
    RAISE EXCEPTION 'Jumia authorization select policy does not allow manage-authorized staff';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jumia_authorizations'
      AND column_name IN ('client_id', 'access_token', 'refresh_token')
  ) THEN
    RAISE EXCEPTION 'Jumia authorization table exposes plaintext credential columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.marketplace_integrations'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(jumia_authorization_id, merchant_id\)'
      AND pg_get_constraintdef(oid) ~ 'REFERENCES (public\.)?jumia_authorizations\(id, merchant_id\)'
  ) THEN
    RAISE EXCEPTION 'shop integrations lack tenant-bound Jumia authorization reference';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.marketplace_integrations'::regclass
      AND conname = 'marketplace_integrations_jumia_authorization_method_check'
      AND pg_get_constraintdef(oid) ~ 'is_active = false'
  ) THEN
    RAISE EXCEPTION 'inactive Jumia self-authorizations cannot detach orphaned grants';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
    RAISE EXCEPTION 'jumia_authorizations row level security is disabled';
  END IF;

  IF to_regprocedure(
    'public.load_jumia_authorization_credentials(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Jumia credential loading worker function is missing';
  END IF;

  IF has_function_privilege(
    'authenticated',
    to_regprocedure('public.load_jumia_authorization_credentials(uuid,uuid)'),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated callers can load Jumia authorization credentials directly';
  END IF;

  IF has_function_privilege(
    'anon',
    to_regprocedure('public.load_jumia_authorization_credentials(uuid,uuid)'),
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous callers can load Jumia authorization credentials';
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_user_id uuid := '9f100000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9f100000-0000-4000-8000-000000000002';
  v_first_inserted boolean;
  v_second_inserted boolean;
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'jumia-auth-test@example.com',
    crypt('password', gen_salt('bf')),
    now(),
    now(),
    now()
  );

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    v_user_id,
    'jumia-auth-test@example.com',
    'Jumia Auth Test Merchant',
    'jumia-auth-test'
  );

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT result.inserted
  INTO v_first_inserted
  FROM public.persist_jumia_self_authorization(
    v_merchant_id,
    repeat('a', 64),
    repeat('b', 32),
    now() + interval '1 hour',
    ARRAY['shop-1'],
    ARRAY['Shop One'],
    ARRAY['NG'],
    ARRAY['default']
  ) AS result
  LIMIT 1;

  SELECT result.inserted
  INTO v_second_inserted
  FROM public.persist_jumia_self_authorization(
    v_merchant_id,
    repeat('a', 64),
    repeat('c', 32),
    now() + interval '2 hours',
    ARRAY['shop-1'],
    ARRAY['Shop One'],
    ARRAY['NG'],
    ARRAY['default']
  ) AS result
  LIMIT 1;

  IF v_first_inserted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first Jumia self-authorization connect should report inserted=true, got %', v_first_inserted;
  END IF;

  IF v_second_inserted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'second Jumia self-authorization connect should report inserted=false, got %', v_second_inserted;
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_user_id uuid := '9f100000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9f100000-0000-4000-8000-000000000002';
  v_distinct_count integer;
BEGIN
  SELECT count(*)
  INTO v_distinct_count
  FROM public.persist_jumia_self_authorization(
    v_merchant_id,
    repeat('a', 64),
    repeat('d', 32),
    now() + interval '1 hour',
    now() + interval '30 days',
    ARRAY['shop-2', 'shop-2'],
    ARRAY['Shop Two', 'Shop Two'],
    ARRAY['NG', 'NG'],
    ARRAY['Nigeria', 'Ghana'],
    ARRAY['NG', 'GH']
  );

  IF v_distinct_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'same-shop distinct business-client selections were not preserved';
  END IF;

  IF (SELECT count(*)
      FROM public.marketplace_integrations
      WHERE merchant_id = v_merchant_id
        AND platform = 'jumia'
        AND shop_id = 'shop-2'
        AND is_active = true) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'same-shop distinct business-client integrations were not stored';
  END IF;

  INSERT INTO public.marketplace_integrations (
    merchant_id, platform, shop_id, marketplace_key, country_code,
    connection_method, is_active
  ) VALUES (
    v_merchant_id, 'jumia', 'shop-3', 'default', 'NG', 'oauth', true
  );

  BEGIN
    PERFORM public.persist_jumia_self_authorization(
      v_merchant_id,
      repeat('a', 64),
      repeat('e', 32),
      now() + interval '1 hour',
      now() + interval '30 days',
      ARRAY['shop-3'],
      ARRAY['Shop Three'],
      ARRAY['NG'],
      ARRAY['Nigeria'],
      ARRAY['NG']
    );
    RAISE EXCEPTION 'self-authorization did not reject an active OAuth shop';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$ LANGUAGE plpgsql;

ROLLBACK;
