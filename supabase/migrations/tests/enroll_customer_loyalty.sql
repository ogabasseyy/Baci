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

-- The storefront enroll route serves guests and authed customers alike.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure,
      LATERAL aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) AS acl_entry
    WHERE procedure.oid = 'public.enroll_customer_loyalty(uuid,uuid,text)'::regprocedure
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  )
  AND has_function_privilege('anon',
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

INSERT INTO public.customers (id, merchant_id, email)
VALUES
  ('01aa0000-0000-4000-8000-000000000011', '01aa0000-0000-4000-8000-000000000001', 'enroll-a@example.com'),
  ('01aa0000-0000-4000-8000-000000000012', '01aa0000-0000-4000-8000-000000000001', 'enroll-b@example.com'),
  ('01aa0000-0000-4000-8000-000000000013', '01aa0000-0000-4000-8000-000000000001', 'enroll-c@example.com');

INSERT INTO public.loyalty_settings (
  merchant_id, enabled, signup_bonus_points, referral_bonus_points
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', true, 50, 100
);

-- 1. Disabled program fail-closes.
UPDATE public.loyalty_settings
SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

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

-- 3. Plain enrollment (as anon, the guest storefront path).
SET LOCAL ROLE anon;
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
RESET ROLE;

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

-- 4. Double enrollment is rejected without side effects.
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

-- 5. Referral enrollment awards the bonus to BOTH sides ("you both get X").
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

-- 6. Unknown referral code never blocks enrollment.
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

ROLLBACK;
