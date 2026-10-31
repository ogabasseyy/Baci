-- Regression coverage for customer-facing wallet and Petrock SELECT policies.
-- Run: psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -f supabase/tests/customer_rls_auth_initplan_parity.sql

BEGIN;

DO $contract$
DECLARE
  v_policy record;
  v_qual text;
BEGIN
  FOR v_policy IN
    SELECT expected.table_name, expected.policy_name
    FROM (VALUES
      ('customer_wallet_accounts', 'customer_reads_own_currency_wallet'),
      ('customer_wallet_account_transactions',
       'customer_reads_own_currency_wallet_transactions'),
      ('petrock_orders', 'customer_reads_own_petrock_orders')
    ) AS expected(table_name, policy_name)
  LOOP
    SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
    INTO STRICT v_qual
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = v_policy.table_name
      AND policy.polname = v_policy.policy_name
      AND policy.polcmd = 'r'
      AND policy.polpermissive
      AND policy.polroles = ARRAY['authenticated'::pg_catalog.regrole]::oid[];

    IF v_qual NOT LIKE '%SELECT auth.uid()%'
      OR v_qual LIKE '%customer.user_id = auth.uid()%'
      OR v_qual LIKE '%c.user_id = auth.uid()%'
    THEN
      RAISE EXCEPTION 'policy %.% does not initplan auth.uid(): %',
        v_policy.table_name, v_policy.policy_name, v_qual;
    END IF;

    IF pg_catalog.has_table_privilege(
      'anon', pg_catalog.format('public.%I', v_policy.table_name), 'SELECT'
    ) THEN
      RAISE EXCEPTION 'anon unexpectedly reads public.%', v_policy.table_name;
    END IF;
  END LOOP;
END;
$contract$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'rls-owner@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('9a0d0e12-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'rls-customer-a@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('9a0d0e12-0000-4000-8000-000000000003',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'rls-customer-b@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('9a0d0e12-0000-4000-8000-000000000004',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'rls-owner-b@example.com', 'test', now(), now(), now(),
   '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, is_published
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000101',
   '9a0d0e12-0000-4000-8000-000000000001',
   'rls-owner@example.com', 'RLS Initplan Fixture',
   'rls-initplan-fixture', true),
  ('9a0d0e12-0000-4000-8000-000000000102',
   '9a0d0e12-0000-4000-8000-000000000004',
   'rls-owner-b@example.com', 'RLS Initplan Fixture B',
   'rls-initplan-fixture-b', true);

INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES
  ('9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000101',
   '9a0d0e12-0000-4000-8000-000000000002', 'rls-customer-a@example.com'),
  ('9a0d0e12-0000-4000-8000-000000000202',
   '9a0d0e12-0000-4000-8000-000000000101',
   '9a0d0e12-0000-4000-8000-000000000003', 'rls-customer-b@example.com');

INSERT INTO public.customer_wallet_accounts (
  id, customer_id, merchant_id, currency, available_balance
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000301',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000101', 'USDT', 5),
  ('9a0d0e12-0000-4000-8000-000000000302',
   '9a0d0e12-0000-4000-8000-000000000202',
   '9a0d0e12-0000-4000-8000-000000000101', 'USDT', 7),
  -- Same customer id, deliberately wrong merchant: must remain invisible.
  ('9a0d0e12-0000-4000-8000-000000000303',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000102', 'USDT', 11);

INSERT INTO public.customer_wallet_account_transactions (
  id, account_id, customer_id, merchant_id, currency, type, amount,
  balance_after, source_type, source_id
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000401',
   '9a0d0e12-0000-4000-8000-000000000301',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000101', 'USDT', 'credit', 5, 5,
   'fixture', '9a0d0e12-0000-4000-8000-000000000501'),
  ('9a0d0e12-0000-4000-8000-000000000402',
   '9a0d0e12-0000-4000-8000-000000000302',
   '9a0d0e12-0000-4000-8000-000000000202',
   '9a0d0e12-0000-4000-8000-000000000101', 'USDT', 'credit', 7, 7,
   'fixture', '9a0d0e12-0000-4000-8000-000000000502'),
  ('9a0d0e12-0000-4000-8000-000000000403',
   '9a0d0e12-0000-4000-8000-000000000303',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000102', 'USDT', 'credit', 11, 11,
   'fixture', '9a0d0e12-0000-4000-8000-000000000503');

INSERT INTO public.imei_lookups (
  id, customer_id, merchant_id, tier, imei_hash, idempotency_key,
  amount_ngn, status
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000601',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000101', 'basic', repeat('a', 64),
   '9a0d0e12-0000-4000-8000-000000000701', 100, 'pending'),
  ('9a0d0e12-0000-4000-8000-000000000602',
   '9a0d0e12-0000-4000-8000-000000000202',
   '9a0d0e12-0000-4000-8000-000000000101', 'basic', repeat('b', 64),
   '9a0d0e12-0000-4000-8000-000000000702', 100, 'pending'),
  ('9a0d0e12-0000-4000-8000-000000000603',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000102', 'basic', repeat('e', 64),
   '9a0d0e12-0000-4000-8000-000000000703', 100, 'pending');

INSERT INTO public.petrock_orders (
  id, customer_id, merchant_id, source_lookup_id, identifier_hash
) VALUES
  ('9a0d0e12-0000-4000-8000-000000000801',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000101',
   '9a0d0e12-0000-4000-8000-000000000601', repeat('c', 64)),
  ('9a0d0e12-0000-4000-8000-000000000802',
   '9a0d0e12-0000-4000-8000-000000000202',
   '9a0d0e12-0000-4000-8000-000000000101',
   '9a0d0e12-0000-4000-8000-000000000602', repeat('d', 64)),
  ('9a0d0e12-0000-4000-8000-000000000803',
   '9a0d0e12-0000-4000-8000-000000000201',
   '9a0d0e12-0000-4000-8000-000000000102',
   '9a0d0e12-0000-4000-8000-000000000603', repeat('f', 64));

CREATE FUNCTION pg_temp.assert_customer_policy_counts(
  p_user_id uuid, p_expected integer
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_accounts integer;
  v_transactions integer;
  v_orders integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT pg_catalog.count(id) INTO v_accounts
  FROM public.customer_wallet_accounts;
  SELECT pg_catalog.count(id) INTO v_transactions
  FROM public.customer_wallet_account_transactions;
  SELECT pg_catalog.count(id) INTO v_orders FROM public.petrock_orders;
  IF v_accounts <> p_expected OR v_transactions <> p_expected
    OR v_orders <> p_expected THEN
    RAISE EXCEPTION 'scope mismatch: accounts %, transactions %, orders %',
      v_accounts, v_transactions, v_orders;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_customer_policy_counts(uuid, integer) TO PUBLIC; -- called after SET ROLE

CREATE FUNCTION pg_temp.assert_customer_policy_initplan(
  p_table_name text
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_plan jsonb;
  v_policy_uses_initplan boolean;
BEGIN
  EXECUTE pg_catalog.format(
    'EXPLAIN (FORMAT JSON) SELECT id FROM public.%I', p_table_name
  ) INTO v_plan;

  WITH RECURSIVE plan_nodes AS (
    SELECT v_plan #> '{0,Plan}' AS node
    UNION ALL
    SELECT child.node
    FROM plan_nodes
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      COALESCE(plan_nodes.node -> 'Plans', '[]'::jsonb)
    ) AS child(node)
  )
  SELECT COALESCE(pg_catalog.bool_or(
    node ->> 'Parent Relationship' = 'InitPlan'
  ), false)
  INTO v_policy_uses_initplan
  FROM plan_nodes;

  IF NOT v_policy_uses_initplan THEN
    RAISE EXCEPTION 'policy plan for public.% is not initplan-backed: %',
      p_table_name, v_plan;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_customer_policy_initplan(text) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9a0d0e12-0000-4000-8000-000000000002',
  true
);
SELECT pg_temp.assert_customer_policy_initplan('customer_wallet_accounts');
SELECT pg_temp.assert_customer_policy_initplan(
  'customer_wallet_account_transactions'
);
SELECT pg_temp.assert_customer_policy_initplan('petrock_orders');
SELECT pg_temp.assert_customer_policy_counts(
  '9a0d0e12-0000-4000-8000-000000000001', 0
);
SELECT pg_temp.assert_customer_policy_counts(
  '9a0d0e12-0000-4000-8000-000000000002', 1
);
SELECT pg_temp.assert_customer_policy_counts(
  '9a0d0e12-0000-4000-8000-000000000003', 1
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_temp.assert_customer_policy_counts(
  '9a0d0e12-0000-4000-8000-000000000001', 3
);
RESET ROLE;

ROLLBACK;
