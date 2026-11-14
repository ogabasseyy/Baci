-- Contract test: the onboarding rollout cohort
-- (20261103012500_piggyvest_primary_rollout_cohort.sql).
--
-- Proves, against live PostgreSQL:
--   * the cohort ships empty, so onboarding stays closed;
--   * the scoped reader answers true only for the exact listed customer,
--     and refuses another merchant's customer, a mismatched user and a
--     disabled integration through the shared onboarding scope fence;
--   * a row naming a customer under another merchant is refused, and a
--     deleted customer leaves no membership behind;
--   * grants and shape through the catalog only (a denied EXECUTE cannot be
--     trapped on the replay image): the onboarding provisioner is the only
--     role that can run the reader, and no role but the owner touches the
--     table.
-- The calls run as the session role, registered as the integration executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_rollout_cohort.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('a4c00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Merchant 1 owns customers 11, 12 and 14; merchant 2 owns customer 13.
-- Customer n belongs to user n + 10. Integration 5 serves merchant 1.
CREATE FUNCTION pg_temp.scope(p_merchant int, p_customer int, p_user int)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', pg_temp.id(p_merchant),
    'customerId', pg_temp.id(p_customer),
    'userId', pg_temp.id(p_user),
    'integrationId', pg_temp.id(5),
    'businessId', 'rollout-cohort-business',
    'environment', 'staging')
$$;

-- 'refused' when the shared scope fence rejects the read, else the answer.
CREATE FUNCTION pg_temp.read(p_scope jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN piggyvest_primary.read_rollout_cohort_membership(p_scope)::text;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'refused';
END $$;

-- 1. The cohort ships empty.
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.rollout_cohort),
  'the rollout cohort must ship empty');

-- Suites that COMMIT can leave an integration bound to this login
-- (executor_login is unique). Move any such row aside for this
-- transaction only; the final ROLLBACK restores it.
UPDATE piggyvest_primary.integrations
  SET executor_login = ('rollout_cohort_displaced_' || substr(md5(id::text), 1, 16))::name
  WHERE executor_login = session_user;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  (pg_temp.id(21)), (pg_temp.id(22)), (pg_temp.id(23)), (pg_temp.id(24));
INSERT INTO public.merchants(id, email) VALUES
  (pg_temp.id(1), 'rollout-cohort-1@example.test'),
  (pg_temp.id(2), 'rollout-cohort-2@example.test');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  (pg_temp.id(11), pg_temp.id(1), pg_temp.id(21)),
  (pg_temp.id(12), pg_temp.id(1), pg_temp.id(22)),
  (pg_temp.id(13), pg_temp.id(2), pg_temp.id(23)),
  (pg_temp.id(14), pg_temp.id(1), pg_temp.id(24));
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES (pg_temp.id(5), pg_temp.id(1), 'rollout-cohort-business', 'staging', session_user, true);

-- 2. Membership is exact: listed customer true, everyone else false.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)) = 'false',
    'an empty cohort admitted a customer');
  INSERT INTO piggyvest_primary.rollout_cohort(merchant_id, customer_id) VALUES
    (pg_temp.id(1), pg_temp.id(11)),
    (pg_temp.id(1), pg_temp.id(14)),
    (pg_temp.id(2), pg_temp.id(13));
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)) = 'true',
    'a listed customer was not admitted');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 12, 22)) = 'false',
    'an unlisted customer of the same merchant was admitted');
END $$;

-- 3. The scope fence refuses foreign tenants, mismatched users and a
--    disabled integration before any membership is read.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 13, 23)) = 'refused',
    'another merchant''s listed customer was read under this integration');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(2, 13, 23)) = 'refused',
    'a merchant without this integration read its cohort');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 22)) = 'refused',
    'a listed customer was read for a different user');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21) - 'environment') = 'refused',
    'an incomplete scope was read');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)
      || jsonb_build_object('environment', 'production')) = 'refused',
    'a scope for another environment was read');
  UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(5);
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)) = 'refused',
    'a disabled integration read the cohort');
  UPDATE piggyvest_primary.integrations SET enabled = true WHERE id = pg_temp.id(5);
  UPDATE piggyvest_primary.integrations SET executor_login = 'rollout_cohort_other_login'
    WHERE id = pg_temp.id(5);
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)) = 'refused',
    'a login that is not the integration executor read the cohort');
  UPDATE piggyvest_primary.integrations SET executor_login = session_user WHERE id = pg_temp.id(5);
END $$;

-- 4. Rows must name a customer of their merchant; deletion leaves none.
DO $$
BEGIN
  BEGIN
    INSERT INTO piggyvest_primary.rollout_cohort(merchant_id, customer_id)
      VALUES (pg_temp.id(1), pg_temp.id(13));
    RAISE EXCEPTION 'a cross-merchant cohort row was stored';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_primary.rollout_cohort SET customer_id = pg_temp.id(13)
      WHERE merchant_id = pg_temp.id(1) AND customer_id = pg_temp.id(11);
    RAISE EXCEPTION 'a cohort row was moved to another merchant''s customer';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_primary.rollout_cohort(merchant_id, customer_id)
      VALUES (pg_temp.id(1), pg_temp.id(11));
    RAISE EXCEPTION 'a duplicate cohort row was stored';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  DELETE FROM public.customers WHERE id = pg_temp.id(14);
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.rollout_cohort
      WHERE customer_id = pg_temp.id(14)),
    'a deleted customer kept its cohort membership');
  PERFORM pg_temp.check(pg_temp.read(pg_temp.scope(1, 11, 21)) = 'true',
    'the refused writes changed an existing membership');
END $$;

-- 5. Catalog: the onboarding provisioner is the only reader; the table is
--    owner-only behind a deny-all policy.
DO $$
DECLARE
  v_table regclass := 'piggyvest_primary.rollout_cohort'::regclass;
  v_reader regprocedure := 'piggyvest_primary.read_rollout_cohort_membership(jsonb)'::regprocedure;
  v_guard regprocedure := 'piggyvest_primary.guard_rollout_cohort_customer()'::regprocedure;
  v_role text;
  v_grantees text[];
  v_stray text[];
BEGIN
  SELECT array_agg(DISTINCT coalesce(grantee.rolname, 'PUBLIC') ORDER BY coalesce(grantee.rolname, 'PUBLIC'))
    INTO v_grantees
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
  LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
  WHERE p.oid = v_reader AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner;
  PERFORM pg_temp.check(v_grantees = ARRAY['piggyvest_primary_provisioner'],
    'reader EXECUTE grantees must be the provisioner only, got ' || coalesce(v_grantees::text, 'none'));

  SELECT array_agg(r.rolname ORDER BY r.rolname) INTO v_stray
  FROM pg_catalog.pg_roles r, pg_catalog.pg_proc p
  WHERE p.oid = v_reader AND NOT r.rolsuper
    AND pg_catalog.has_function_privilege(r.oid, v_reader, 'EXECUTE')
    AND NOT pg_catalog.pg_has_role(r.oid, p.proowner, 'USAGE')
    AND NOT pg_catalog.pg_has_role(r.oid, 'piggyvest_primary_provisioner', 'USAGE');
  PERFORM pg_temp.check(v_stray IS NULL,
    'roles outside the provisioner can run the cohort reader: ' || coalesce(v_stray::text, ''));

  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_reader, 'EXECUTE'),
      v_role || ' can read the rollout cohort');
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_guard, 'EXECUTE'),
      v_role || ' can execute the cohort guard');
  END LOOP;
  PERFORM pg_temp.check(pg_catalog.has_function_privilege('piggyvest_primary_provisioner', v_reader, 'EXECUTE'),
    'the onboarding provisioner cannot read the rollout cohort');
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_goal_provisioner') THEN
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege('piggyvest_primary_goal_provisioner', v_reader, 'EXECUTE'),
      'the goal provisioner can read the rollout cohort');
  END IF;
  PERFORM pg_temp.check((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      FROM pg_catalog.pg_proc p WHERE p.oid = v_reader),
    'the cohort reader must be SECURITY DEFINER with search_path pg_catalog');
  PERFORM pg_temp.check((SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      FROM pg_catalog.pg_proc p WHERE p.oid = v_guard),
    'the cohort guard must run as the caller with search_path pg_catalog');
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      WHERE p.oid = v_guard AND acl.grantee <> p.proowner),
    'the cohort guard has an EXECUTE grantee besides its owner');

  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
      WHERE c.oid = v_table AND acl.grantee <> c.relowner),
    'the rollout cohort table has a grantee besides its owner');
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role', 'piggyvest_primary_provisioner'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_table_privilege(v_role, v_table,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
      v_role || ' has direct access to the rollout cohort');
  END LOOP;
  PERFORM pg_temp.check((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_table),
    'row level security is off on the rollout cohort');
  PERFORM pg_temp.check(EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = v_table AND NOT pol.polpermissive AND pol.polcmd = '*'
        AND pol.polroles = ARRAY[0::oid]
        AND pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'false'
        AND pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) = 'false'),
    'the rollout cohort lacks its restrictive deny-all policy');
  PERFORM pg_temp.check(EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = v_table AND a.attname = 'customer_id'),
    'the rollout cohort customer foreign key is not indexed');
END $$;

ROLLBACK;
