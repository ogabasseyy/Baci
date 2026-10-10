-- Enrollment cases for the enroll_customer_loyalty suite (cases 1-5).

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

-- 3. Cross-customer enrollment is indistinguishable from unknown-customer.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     NULL
   ) AS result),
  'cross-customer enrollment disclosed membership'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'),
  'rejected enrollment left a partial mutation'
);

-- 3b. Soft-deleted customers cannot enroll.
UPDATE public.customers
SET deleted_at = now()
WHERE id = '01aa0000-0000-4000-8000-000000000017';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000107');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000017',
     NULL
   ) AS result),
  'soft-deleted customer was allowed to enroll'
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

