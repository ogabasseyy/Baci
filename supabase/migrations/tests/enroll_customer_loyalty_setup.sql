-- Setup for the enroll_customer_loyalty regression suite: transaction,
-- helpers, grant assertions, and fixtures. Included by
-- enroll_customer_loyalty.sql via \ir (same session/transaction).

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END;
$$;

-- Simulate an authenticated storefront caller for auth.uid().
CREATE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', p_user::text)::text, true);
END;
$$;

-- Only sessions may execute: no PUBLIC grant, no anon EXECUTE, and both
-- authenticated and service_role can execute.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.enroll_customer_loyalty(uuid,uuid,text)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.enroll_customer_loyalty(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.enroll_customer_loyalty(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.enroll_customer_loyalty(uuid,uuid,text)', 'EXECUTE'),
  'enroll_customer_loyalty grants are incorrect'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.get_loyalty_status(uuid,uuid)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.get_loyalty_status(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.get_loyalty_status(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.get_loyalty_status(uuid,uuid)', 'EXECUTE'),
  'get_loyalty_status grants are incorrect'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.redeem_loyalty_reward(uuid,uuid,uuid)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.redeem_loyalty_reward(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.redeem_loyalty_reward(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.redeem_loyalty_reward(uuid,uuid,uuid)', 'EXECUTE'),
  'redeem_loyalty_reward grants are incorrect'
);

-- The FIFO expiry helper has no ownership check, so only the SECURITY
-- DEFINER loyalty RPCs may reach it (definer's rights): no PUBLIC grant,
-- no anon EXECUTE, no authenticated EXECUTE, service_role only.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.calculate_unspent_expired_points(uuid,uuid)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.calculate_unspent_expired_points(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.calculate_unspent_expired_points(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.calculate_unspent_expired_points(uuid,uuid)', 'EXECUTE'),
  'calculate_unspent_expired_points grants are incorrect'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.adjust_loyalty_points(uuid,uuid,integer,text,text)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.adjust_loyalty_points(uuid,uuid,integer,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.adjust_loyalty_points(uuid,uuid,integer,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.adjust_loyalty_points(uuid,uuid,integer,text,text)', 'EXECUTE'),
  'adjust_loyalty_points grants are incorrect'
);

-- The tier-order migration closes the baseline's anon grant on the tier
-- projection: only sessions may execute it directly.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.calculate_loyalty_tier(integer,uuid)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon',
    'public.calculate_loyalty_tier(integer,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.calculate_loyalty_tier(integer,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.calculate_loyalty_tier(integer,uuid)', 'EXECUTE'),
  'calculate_loyalty_tier grants are incorrect'
);

-- Fixtures.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
SELECT
  ('01aa0000-0000-4000-8000-00000000010' || seq::text)::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'enroll-user-' || seq || '@example.com',
  'test', now(), now(), now(), '{}', '{}'
FROM generate_series(1, 8) AS seq;

-- merchants writes fire the identity-audit trigger, whose canonical writer
-- raises audit_actor_required (28000) without a JWT role actor: seed this
-- row as service_role like the other merchants-seeding replay checks.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  'loyalty-enroll-merchant@example.com',
  'Loyalty Enroll Merchant',
  'loyalty-enroll-merchant'
);
RESET ROLE;

INSERT INTO public.customers (id, merchant_id, email, user_id)
VALUES
  ('01aa0000-0000-4000-8000-000000000011', '01aa0000-0000-4000-8000-000000000001', 'enroll-a@example.com', '01aa0000-0000-4000-8000-000000000101'),
  ('01aa0000-0000-4000-8000-000000000012', '01aa0000-0000-4000-8000-000000000001', 'enroll-b@example.com', '01aa0000-0000-4000-8000-000000000102'),
  ('01aa0000-0000-4000-8000-000000000013', '01aa0000-0000-4000-8000-000000000001', 'enroll-c@example.com', '01aa0000-0000-4000-8000-000000000103'),
  ('01aa0000-0000-4000-8000-000000000014', '01aa0000-0000-4000-8000-000000000001', 'enroll-d@example.com', '01aa0000-0000-4000-8000-000000000104'),
  ('01aa0000-0000-4000-8000-000000000015', '01aa0000-0000-4000-8000-000000000001', 'enroll-e@example.com', '01aa0000-0000-4000-8000-000000000105'),
  ('01aa0000-0000-4000-8000-000000000016', '01aa0000-0000-4000-8000-000000000001', 'enroll-f@example.com', '01aa0000-0000-4000-8000-000000000106'),
  ('01aa0000-0000-4000-8000-000000000017', '01aa0000-0000-4000-8000-000000000001', 'enroll-g@example.com', '01aa0000-0000-4000-8000-000000000107'),
  ('01aa0000-0000-4000-8000-000000000018', '01aa0000-0000-4000-8000-000000000001', 'enroll-h@example.com', '01aa0000-0000-4000-8000-000000000108');

INSERT INTO public.loyalty_settings (
  merchant_id, enabled, signup_bonus_points, referral_bonus_points,
  minimum_redemption_points
) VALUES (
  -- Minimum 100 (baseline default is 500): every redemption case below
  -- runs with balance >= 150, so the program minimum never shadows the
  -- insufficient-points and availability cases; the minimum gate itself
  -- is covered by raising it in the redemption file.
  '01aa0000-0000-4000-8000-000000000001', true, 50, 100,
  100
);

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled, end_date, stock_quantity
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Free shipping', 200, 'free_shipping', true, NULL, NULL),
  ('01aa0000-0000-4000-8000-000000000001', 'Disabled perk', 100, 'discount', false, NULL, NULL),
  ('01aa0000-0000-4000-8000-000000000001', 'Expired perk', 150, 'discount', true, now() - interval '1 day', NULL),
  ('01aa0000-0000-4000-8000-000000000001', 'Sold-out perk', 120, 'discount', true, NULL, 0);
