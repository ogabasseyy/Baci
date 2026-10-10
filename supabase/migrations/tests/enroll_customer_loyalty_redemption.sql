-- Redemption cases for the enroll_customer_loyalty suite (cases 15-18).

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled, stock_quantity
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Limited perk', 100, 'discount', true, 2
);

-- 15. A member redeems atomically: deduction, redemption, and ledger row.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_spent')::integer = 200
     AND (result ->> 'new_balance')::integer = 1300
     AND result ->> 'reward_name' = 'Free shipping'
     AND (result ->> 'redemption_code') LIKE 'RDM-%'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'redemption returned the wrong payload'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 1300
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018')
  AND (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'
     AND points_spent = 200
     AND used IS FALSE)
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'
     AND type = 'redemption'
     AND points = -200
     AND balance_after = 1300
     AND source = 'redemption'),
  'redemption wrote the wrong rows'
);

-- 16. Insufficient points fail with required/available and no mutation.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'insufficient_points'
     AND (result ->> 'required')::integer = 200
     AND (result ->> 'available')::integer = 150
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'short-balance redemption was not rejected'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 150
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012')
  AND (SELECT count(*) = 0
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'rejected redemption left a partial mutation'
);

-- 17. Disabled, expired, and exhausted rewards are unavailable; ownership
-- and enrollment still gate before availability.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Disabled perk')
   ) AS result)
  AND (SELECT result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Sold-out perk')
   ) AS result),
  'unavailable rewards were redeemable'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'cross-customer redemption disclosed membership'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000106');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'not_enrolled'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'non-enrolled redemption was not rejected'
);

-- 18. Finite stock decrements per redemption, then sells out.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Limited perk')
   ) AS result),
  'first finite redemption failed'
);

SELECT pg_temp.assert_true(
  (SELECT stock_quantity = 1
   FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Limited perk'),
  'first finite redemption did not decrement stock'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Limited perk')
   ) AS result),
  'second finite redemption failed'
);

SELECT pg_temp.assert_true(
  (SELECT stock_quantity = 0
   FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Limited perk'),
  'second finite redemption did not sell out'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Limited perk')
   ) AS result),
  'sold-out reward stayed redeemable'
);
