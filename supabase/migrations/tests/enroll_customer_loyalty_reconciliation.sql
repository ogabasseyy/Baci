-- Expiry-FIFO, minimum, and discount-value cases for
-- the enroll_customer_loyalty suite (cases 23-26). Runs after the
-- redemption cases: the FIFO and minimum cases mutate shared settings
-- (restored after each case) and member balances no later case depends on.

-- 23. Expiry deducts only the unspent remainder (FIFO): earn 100 expired,
-- spend 80, then receive 50 permanent points. The write-off is 20 — not
-- the gross 100 — and the 50 permanent points survive. (Member 014
-- enters clean: balance 0, no ledger rows. Explicit created_at pins the
-- lot order: now() is constant inside this transaction.)
UPDATE public.customer_loyalty
SET points_balance = 70, lifetime_points = 150
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000014';

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, expires_at, created_at
) VALUES
  ('01aa0000-0000-4000-8000-000000000014',
   '01aa0000-0000-4000-8000-000000000001',
   'earn', 100, 100, 'purchase', 'Old purchase',
   now() - interval '1 day', now() - interval '10 days'),
  ('01aa0000-0000-4000-8000-000000000014',
   '01aa0000-0000-4000-8000-000000000001',
   'redemption', -80, 20, 'redemption', 'Old redemption',
   NULL, now() - interval '9 days'),
  ('01aa0000-0000-4000-8000-000000000014',
   '01aa0000-0000-4000-8000-000000000001',
   'bonus', 50, 70, 'loyalty_enrollment', 'Signup bonus',
   NULL, now() - interval '8 days');

UPDATE public.loyalty_settings
SET minimum_redemption_points = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000104');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 0
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000014',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Small perk')
   ) AS result),
  'FIFO expiry deducted the gross earn instead of the remainder'
);

SELECT pg_temp.assert_true(
  (SELECT expired IS TRUE
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000014'
     AND type = 'earn'
     AND points = 100)
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000014'
     AND type = 'expiry'
     AND points = -20
     AND balance_after = 50
     AND source = 'expiry')
  AND (SELECT points_balance = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000014'),
  'FIFO expiry wrote the wrong rows'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 24. A fully-spent expired lot reconciles to zero: earn 60 (oldest lot),
-- spend 60. No expiry row is written and the balance is untouched by
-- reconciliation. (Member 013 enters at 50 with a signup bonus row.)
UPDATE public.customer_loyalty
SET points_balance = 110, lifetime_points = 110
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000013';

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, expires_at, created_at
) VALUES
  ('01aa0000-0000-4000-8000-000000000013',
   '01aa0000-0000-4000-8000-000000000001',
   'earn', 60, 110, 'purchase', 'Spent purchase',
   now() - interval '1 day', now() - interval '90 days'),
  ('01aa0000-0000-4000-8000-000000000013',
   '01aa0000-0000-4000-8000-000000000001',
   'redemption', -60, 50, 'redemption', 'Old redemption',
   NULL, now() - interval '2 days');

UPDATE public.loyalty_settings
SET minimum_redemption_points = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000103');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 60
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000013',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Small perk')
   ) AS result),
  'fully-spent expired lot blocked redemption'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000013'
     AND type = 'expiry')
  AND (SELECT points_balance = 60
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000013'),
  'fully-spent expired lot wrote a phantom write-off'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 25. The minimum compares against the redeemed cost: with minimum 500,
-- member 018 (balance 600 after case 22) is rejected on a 100-cost
-- reward — points_cost carries the attempted cost while available keeps
-- the member balance — and a 500-cost reward clears the gate.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Cheap perk', 100,
   'discount', true),
  ('01aa0000-0000-4000-8000-000000000001', 'Big perk', 500,
   'discount', true);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'minimum_not_met'
     AND (result ->> 'required')::integer = 500
     AND (result ->> 'available')::integer = 600
     AND (result ->> 'points_cost')::integer = 100
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Cheap perk')
   ) AS result),
  'large balance bypassed the minimum on a cheap reward'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 100
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Big perk')
   ) AS result),
  'minimum-cost reward did not clear the gate'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 26. Valueless discount_fixed / discount_percentage rewards fail closed:
-- NULL, zero, and negative values are rejected with no mutation (finite
-- stock proves no decrement), while a well-formed fixed discount
-- redeems. (Member 012 enters at 50 after case 20.)
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled,
  stock_quantity
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Null fixed', 50,
   'discount_fixed', NULL, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Zero pct', 50,
   'discount_percentage', 0, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Negative fixed', 50,
   'discount_fixed', -10, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Good fixed', 50,
   'discount_fixed', 500, true, 5);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Null fixed')
   ) AS result)
  AND (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Zero pct')
   ) AS result)
  AND (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Negative fixed')
   ) AS result),
  'valueless discount reward was redeemable'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 3
   FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name IN ('Null fixed', 'Zero pct', 'Negative fixed')
     AND stock_quantity = 5)
  AND (SELECT points_balance = 50
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'rejected valueless discount left a partial mutation'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 0
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Good fixed')
   ) AS result),
  'well-formed fixed discount did not redeem'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';
