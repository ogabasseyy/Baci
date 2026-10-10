-- Referral, edge, and tier cases for the enroll_customer_loyalty suite (cases 6-11).

-- 6. Referral enrollment awards the bonus to BOTH sides ("you both get X").
-- The referrer's balances are nulled first to prove legacy NULL rows are
-- credited (COALESCE) instead of staying NULL.
UPDATE public.customer_loyalty
SET points_balance = NULL, lifetime_points = NULL
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000011';

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
  (SELECT points_balance = 100
     AND lifetime_points = 100
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
     AND balance_after = 100
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

-- 10. Purchase awards serialize with referral credits and enrollments:
-- the row lock stops stale-balance overwrites, and both writers take the
-- same advisory creation lock so a first purchase racing enrollment cannot
-- create a duplicate row. (True interleaving needs two connections, which
-- the single-session sql-check harness cannot express; these assertions
-- pin the mechanism on both writers instead.)
SELECT pg_temp.assert_true(
  pg_get_functiondef(
    'public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure
  ) LIKE '%FOR UPDATE%',
  'award_purchase_points does not lock the loyalty row'
);

SELECT pg_temp.assert_true(
  (SELECT regexp_match(
    pg_get_functiondef('public.enroll_customer_loyalty(uuid,uuid,text)'::regprocedure),
    'pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\(([^)]*)\)'
  )) IS NOT NULL
  AND (SELECT regexp_match(
    pg_get_functiondef('public.enroll_customer_loyalty(uuid,uuid,text)'::regprocedure),
    'pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\(([^)]*)\)'
  )) = (SELECT regexp_match(
    pg_get_functiondef('public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure),
    'pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\(([^)]*)\)'
  )),
  'enrollment and purchase awards do not share one creation lock'
);

-- 11. A soft-deleted referrer's code is ignored: enrollment succeeds
-- without the referee bonus and the deleted account is untouched.
INSERT INTO public.customer_loyalty (
  merchant_id, customer_id, points_balance, lifetime_points,
  current_tier, referral_code
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000017',
  40, 40, 'Bronze', 'DELETED1'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 1500
     AND result ->> 'referral_bonus_applied' = 'false'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     'deleted1'
   ) AS result),
  'soft-deleted referrer code granted a bonus'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 40
     AND lifetime_points = 40
     AND referral_count = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000017')
  AND (SELECT count(*) = 0
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000017'),
  'soft-deleted referrer account was mutated'
);

