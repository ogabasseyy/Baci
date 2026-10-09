-- Runtime regression contract for 20261009120000_enroll_customer_loyalty.sql.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/enroll_customer_loyalty.sql

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

-- Fixtures.
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  'loyalty-enroll-merchant@example.com',
  'Loyalty Enroll Merchant',
  'loyalty-enroll-merchant'
);

INSERT INTO public.customers (id, merchant_id, email, user_id)
VALUES
  ('01aa0000-0000-4000-8000-000000000011', '01aa0000-0000-4000-8000-000000000001', 'enroll-a@example.com', '01aa0000-0000-4000-8000-000000000101'),
  ('01aa0000-0000-4000-8000-000000000012', '01aa0000-0000-4000-8000-000000000001', 'enroll-b@example.com', '01aa0000-0000-4000-8000-000000000102'),
  ('01aa0000-0000-4000-8000-000000000013', '01aa0000-0000-4000-8000-000000000001', 'enroll-c@example.com', '01aa0000-0000-4000-8000-000000000103'),
  ('01aa0000-0000-4000-8000-000000000014', '01aa0000-0000-4000-8000-000000000001', 'enroll-d@example.com', '01aa0000-0000-4000-8000-000000000104'),
  ('01aa0000-0000-4000-8000-000000000015', '01aa0000-0000-4000-8000-000000000001', 'enroll-e@example.com', '01aa0000-0000-4000-8000-000000000105');

INSERT INTO public.loyalty_settings (
  merchant_id, enabled, signup_bonus_points, referral_bonus_points
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', true, 50, 100
);

-- 1. Disabled program fail-closes.
UPDATE public.loyalty_settings
SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'program_unavailable'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     NULL
   ) AS result),
  'disabled loyalty program did not fail closed'
);

UPDATE public.loyalty_settings
SET enabled = true
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 2. Unknown customer fail-closes.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000099',
     NULL
   ) AS result),
  'unknown customer did not fail closed'
);

-- 3. Cross-customer enrollment is forbidden.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'forbidden'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     NULL
   ) AS result),
  'cross-customer enrollment was not forbidden'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'),
  'forbidden enrollment left a partial mutation'
);

-- 4. Plain enrollment as the owning customer.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 50
     AND (result ->> 'lifetime_points')::integer = 50
     AND result ->> 'current_tier' = 'Bronze'
     AND length(result ->> 'referral_code') = 8
     AND result ->> 'referral_bonus_applied' = 'false'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     NULL
   ) AS result),
  'plain enrollment returned the wrong payload'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 50
     AND lifetime_points = 50
     AND current_tier = 'Bronze'
     AND referral_code IS NOT NULL
     AND referred_by_customer_id IS NULL
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'),
  'plain enrollment wrote the wrong customer_loyalty row'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'
     AND type = 'bonus'
     AND points = 50
     AND balance_after = 50
     AND source = 'loyalty_enrollment'),
  'plain enrollment wrote the wrong points_transactions row'
);

-- 5. Double enrollment is rejected without side effects.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'already_enrolled'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     NULL
   ) AS result),
  'double enrollment was not rejected'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011')
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'),
  'rejected double enrollment left a partial mutation'
);

-- 6. Referral enrollment awards the bonus to BOTH sides ("you both get X").
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 150
     AND result ->> 'referral_bonus_applied' = 'true'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT referral_code
      FROM public.customer_loyalty
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND customer_id = '01aa0000-0000-4000-8000-000000000011')
   ) AS result),
  'referral enrollment returned the wrong payload'
);

SELECT pg_temp.assert_true(
  (SELECT referred_by_customer_id = '01aa0000-0000-4000-8000-000000000011'
     AND points_balance = 150
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'referee row is missing the referrer link or points'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'
     AND type = 'referral'
     AND points = 100
     AND balance_after = 150
     AND source = 'loyalty_referral'),
  'referee referral ledger row is wrong'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 150
     AND lifetime_points = 150
     AND referral_count = 1
     AND current_tier = 'Bronze'
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'),
  'referrer did not receive the atomic bonus + count'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'
     AND type = 'referral'
     AND points = 100
     AND balance_after = 150
     AND source = 'loyalty_referral'),
  'referrer referral ledger row is wrong'
);

-- 7. Unknown referral code never blocks enrollment.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000103');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 50
     AND result ->> 'referral_bonus_applied' = 'false'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000013',
     'NOPE0000'
   ) AS result),
  'unknown referral code blocked enrollment'
);

-- 8. Negative bonus config clamps to zero (never negative balances).
UPDATE public.loyalty_settings
SET signup_bonus_points = -50, referral_bonus_points = -100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000104');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 0
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000014',
     NULL
   ) AS result),
  'negative bonus config was not clamped to zero'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 0 AND lifetime_points = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000014')
  AND (SELECT count(*) = 0
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000014'),
  'negative bonus config wrote negative balances or ledger rows'
);

-- 9. A signup bonus crossing a tier threshold enrolls above Bronze.
UPDATE public.loyalty_settings
SET signup_bonus_points = 1500, referral_bonus_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 1500
     AND result ->> 'current_tier' = 'Silver'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015',
     NULL
   ) AS result),
  'tier-crossing enrollment returned the wrong tier'
);

SELECT pg_temp.assert_true(
  (SELECT current_tier = 'Silver'
     AND points_balance = 1500
     AND lifetime_points = 1500
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000015'),
  'tier-crossing enrollment wrote the wrong tier'
);

ROLLBACK;
