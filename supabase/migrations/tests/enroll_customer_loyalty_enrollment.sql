-- Enrollment cases for the enroll_customer_loyalty suite (cases 1-5c).

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

-- Guest-link fixtures: the hint is evaluated inside the RPC with the
-- definer's rights (shoppers cannot read unlinked rows under RLS), so
-- these logins need auth.users rows, not just JWT claims.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('01aa0000-0000-4000-8000-000000000109',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guest-link@example.com',
   'test', now(), now(), now(), '{}', '{}'),
  ('01aa0000-0000-4000-8000-000000000110',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guest-unverified@example.com',
   'test', NULL, now(), now(), '{}', '{}');

INSERT INTO public.customers (id, merchant_id, email, user_id)
VALUES
  ('01aa0000-0000-4000-8000-000000000019',
   '01aa0000-0000-4000-8000-000000000001',
   'Guest-Link@Example.COM', NULL),
  ('01aa0000-0000-4000-8000-000000000020',
   '01aa0000-0000-4000-8000-000000000001',
   'guest-unverified@example.com', NULL),
  ('01aa0000-0000-4000-8000-000000000021',
   '01aa0000-0000-4000-8000-000000000001',
   'someone-else@example.com', NULL);

-- 3c. A logged-in shopper whose row predates their login gets a re-link
-- hint instead of a bare 404: the unlinked row's email matches the
-- caller's verified login address case-insensitively. No row is written.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000109');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'guest_link_required'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000019',
     NULL
   ) AS result),
  'owned unlinked guest row did not return the re-link hint'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.customer_loyalty
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND customer_id = '01aa0000-0000-4000-8000-000000000019'
  ),
  'guest-link hint wrote an enrollment row'
);

-- 3d. The hint requires a verified login email: an unverified address
-- stays a plain customer_not_found so it cannot probe linkage.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000110');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000020',
     NULL
   ) AS result),
  'unverified guest login did not fail closed to customer_not_found'
);

-- 3e. The hint never confirms or denies other customers: a verified
-- login asking about an unlinked row with a different email gets the
-- same customer_not_found as a missing row.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000109');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.enroll_customer_loyalty(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000021',
     NULL
   ) AS result),
  'foreign unlinked row did not fail closed to customer_not_found'
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
-- Digit strings past the integer range compare as NUMERIC: they simply
-- never match instead of raising integer out of range.
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
SET tiers = '[{"name": "Silver", "minPoints": 99999999999}, {"name": "Bronze", "minPoints": 0}]'::jsonb
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.calculate_loyalty_tier(
    1500, '01aa0000-0000-4000-8000-000000000001'
  ) = 'Bronze',
  'out-of-range minPoints matched or raised'
);

UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

