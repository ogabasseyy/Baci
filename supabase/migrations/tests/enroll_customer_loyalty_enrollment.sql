-- Enrollment cases for the enroll_customer_loyalty suite (cases 1-5b).

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

-- 5b. Tier assignment follows thresholds, not stored array order: with
-- Silver stored before Bronze, last-match-wins over stored order would
-- wrongly assign Bronze at 1500 lifetime points.
UPDATE public.loyalty_settings
SET tiers = '[{"name": "Silver", "minPoints": 1000}, {"name": "Bronze", "minPoints": 0}]'::jsonb
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.calculate_loyalty_tier(
    1500, '01aa0000-0000-4000-8000-000000000001'
  ) = 'Silver',
  'unsorted tier JSON assigned the wrong tier'
);

UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 5c. Non-numeric minPoints never matches and never raises: merchant tier
-- JSON is arbitrary, so 'abc' is treated like NULL (sorts last, matches
-- nothing) instead of aborting the enrollment transaction on the cast.
UPDATE public.loyalty_settings
SET tiers = '[{"name": "Silver", "minPoints": "abc"}, {"name": "Bronze", "minPoints": 0}]'::jsonb
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.calculate_loyalty_tier(
    1500, '01aa0000-0000-4000-8000-000000000001'
  ) = 'Bronze',
  'non-numeric minPoints matched or raised'
);

UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 5d. Purchase awards coalesce NULL balances: legacy member rows predate
-- the DEFAULT 0 backfill, and without COALESCE the NULL propagates into
-- the UPDATE and the NOT NULL balance_after ledger, aborting checkout.
-- (Isolated second merchant: earning-config mutations must not leak into
-- the referral/status cases below.)
SET LOCAL ROLE service_role;
INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '02aa0000-0000-4000-8000-000000000001',
  'loyalty-award-merchant@example.com',
  'Loyalty Award Merchant',
  'loyalty-award-merchant'
);
RESET ROLE;

INSERT INTO public.customers (id, merchant_id, email)
VALUES (
  '02aa0000-0000-4000-8000-000000000011',
  '02aa0000-0000-4000-8000-000000000001',
  'award-a@example.com'
);

INSERT INTO public.loyalty_settings (
  merchant_id, enabled, points_currency_unit, points_per_currency,
  points_expiry_days
) VALUES (
  '02aa0000-0000-4000-8000-000000000001', true, 100, 1, 30
);

INSERT INTO public.customer_loyalty (
  merchant_id, customer_id, points_balance, lifetime_points, current_tier
) VALUES (
  '02aa0000-0000-4000-8000-000000000001',
  '02aa0000-0000-4000-8000-000000000011',
  NULL, NULL, 'Bronze'
);

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a1',
    250
  ) = 2,
  'award on NULL balances returned the wrong points'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 2 AND lifetime_points = 2
   FROM public.customer_loyalty
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011')
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
     AND customer_id = '02aa0000-0000-4000-8000-000000000011'
     AND type = 'earn'
     AND points = 2
     AND balance_after = 2),
  'award on NULL balances wrote NULLs or skipped the ledger'
);

-- 5e. NULL or zero earning divisors award 0 instead of erroring: NULL
-- points would slip past the <= 0 check and a zero divisor raises
-- division-by-zero, failing checkout.
UPDATE public.loyalty_settings
SET points_currency_unit = 0
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a2',
    250
  ) = 0,
  'zero divisor did not award 0'
);

UPDATE public.loyalty_settings
SET points_currency_unit = NULL
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a3',
    250
  ) = 0,
  'NULL divisor did not award 0'
);

-- 5f. First-purchase enrollment retries referral-code collisions like the
-- enrollment RPC: a blindly generated code can hit the case-insensitive
-- unique index and must not lose the award. (Forcing a real RNG collision
-- deterministically is infeasible in one session; pin the retry loop on
-- the function definition like the creation-lock assertions do.)
SELECT pg_temp.assert_true(
  pg_get_functiondef(
    'public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure
  ) LIKE '%EXCEPTION WHEN unique_violation%'
  AND pg_get_functiondef(
    'public.award_purchase_points(uuid,uuid,uuid,numeric)'::regprocedure
  ) LIKE '%v_attempt >= 5%',
  'award_purchase_points does not retry referral-code collisions'
);

