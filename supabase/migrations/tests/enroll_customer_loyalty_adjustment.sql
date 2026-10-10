-- Manual-adjustment cases for the enroll_customer_loyalty suite (cases
-- 29-31). Runs last: merchant membership fixtures (owner user_id, staff
-- rows) are set here so earlier customer-authenticated cases are
-- unaffected.

-- Owner and staff identities for merchant 1 (user 103 stays a plain
-- customer for the non-member negative below).
UPDATE public.merchants
SET user_id = '01aa0000-0000-4000-8000-000000000101'
WHERE id = '01aa0000-0000-4000-8000-000000000001';

INSERT INTO public.staff_members (merchant_id, user_id, email, status)
VALUES
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000102',
   'adjust-staff@example.com', 'active'),
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000104',
   'adjust-suspended@example.com', 'suspended');

-- 29. A first manual award creates the member row atomically: balances,
-- ledger row, and tier in one call. (Member 016 enters unenrolled.)
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 200
     AND (result ->> 'lifetime_points')::integer = 200
     AND (result ->> 'points_awarded')::integer = 200
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     200, 'Welcome top-up', 'adjust'
   ) AS result),
  'first manual award returned the wrong payload'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 200
     AND lifetime_points = 200
     AND current_tier = 'Bronze'
     AND length(referral_code) = 8
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016')
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016'
     AND type = 'adjust'
     AND points = 200
     AND balance_after = 200
     AND source = 'admin_adjust'
     AND description = 'Welcome top-up'),
  'first manual award wrote the wrong rows'
);

-- 30. Deductions keep lifetime, tier crossings recompute, and every guard
-- fails closed without mutation: active staff may adjust, but unknown,
-- foreign, and deleted customers, negative balances, zero points,
-- forged types, non-members, and suspended staff are all rejected.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 150
     AND (result ->> 'lifetime_points')::integer = 200
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     -50, NULL, 'adjust'
   ) AS result),
  'staff deduction failed or moved lifetime'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 1050
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     900, NULL, 'adjust'
   ) AS result),
  'tier-crossing adjustment failed'
);

SELECT pg_temp.assert_true(
  (SELECT current_tier = 'Silver'
     AND points_balance = 1050
     AND lifetime_points = 1100
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016')
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016'
     AND type = 'adjust'
     AND points = -50
     AND description = 'Manual adjustment by merchant: -50 points'),
  'adjustment wrote the wrong tier or default description'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'error' = 'customer_not_found'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000099',
     10, NULL, 'adjust'
   ) AS result)
  AND (SELECT result ->> 'error' = 'customer_not_found'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '02aa0000-0000-4000-8000-000000000011',
     10, NULL, 'adjust'
   ) AS result)
  AND (SELECT result ->> 'error' = 'customer_not_found'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000017',
     10, NULL, 'adjust'
   ) AS result)
  AND (SELECT result ->> 'error' = 'negative_balance'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     -9999, NULL, 'adjust'
   ) AS result)
  AND (SELECT result ->> 'error' = 'invalid_input'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     0, NULL, 'adjust'
   ) AS result)
  AND (SELECT result ->> 'error' = 'invalid_input'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     10, NULL, 'earn'
   ) AS result),
  'adjustment guard was not enforced'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000103');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'merchant_not_found'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     10, NULL, 'adjust'
   ) AS result),
  'non-member manual adjustment was not rejected'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000104');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'merchant_not_found'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     10, NULL, 'adjust'
   ) AS result),
  'suspended-staff manual adjustment was not rejected'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 1050 AND lifetime_points = 1100
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016')
  AND (SELECT count(*) = 3
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016'),
  'rejected adjustment left a partial mutation'
);

-- 31. Adjustments serialize like the other writers: the member row is
-- locked for the read-modify-write and creation shares the enrollment
-- advisory key. (Single-session harness: pin the mechanism on the
-- function definition, like case 10.)
SELECT pg_temp.assert_true(
  pg_get_functiondef(
    'public.adjust_loyalty_points(uuid,uuid,integer,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE%',
  'adjust_loyalty_points does not lock the loyalty row'
);

SELECT pg_temp.assert_true(
  (SELECT regexp_match(
    pg_get_functiondef('public.adjust_loyalty_points(uuid,uuid,integer,text,text)'::regprocedure),
    'pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\(([^)]*)\)'
  )) = (SELECT regexp_match(
    pg_get_functiondef('public.enroll_customer_loyalty(uuid,uuid,text)'::regprocedure),
    'pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\(([^)]*)\)'
  )),
  'adjustment and enrollment do not share one creation lock'
);

-- 31b. Computed totals are range-checked in bigint: an in-range delta on
-- a near-limit balance rejects with out_of_range instead of overflowing
-- mid-write into a 500. (Runs last; member 016 balances are retired.)
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

UPDATE public.customer_loyalty
SET points_balance = 2147483640, lifetime_points = 2147483640
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000016';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'out_of_range'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     100, NULL, 'adjust'
   ) AS result),
  'overflowing adjustment was not rejected'
);

UPDATE public.customer_loyalty
SET points_balance = -5, lifetime_points = 0
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000016';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'out_of_range'
   FROM public.adjust_loyalty_points(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     -2147483648, NULL, 'adjust'
   ) AS result),
  'underflowing adjustment was not rejected'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = -5 AND lifetime_points = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016')
  AND (SELECT count(*) = 3
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000016'),
  'rejected out-of-range adjustment mutated state'
);
