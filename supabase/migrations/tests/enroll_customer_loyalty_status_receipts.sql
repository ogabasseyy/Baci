-- Status receipt-window cases for the enroll_customer_loyalty suite
-- (case 33). Runs last: fixtures are self-contained and nothing runs
-- after.
--
-- 33. Unused redemption receipts survive beyond the ten-row history
-- window: eleven newer transactions bury the redemption, but its receipt
-- row is still returned (a lost redeem response stays recoverable).
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Old receipt perk', 100,
  'discount_fixed', 500, true
);

UPDATE public.customer_loyalty SET points_balance = 500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012',
  (SELECT id FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Old receipt perk')
);

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, created_at
)
SELECT '01aa0000-0000-4000-8000-000000000012',
  '01aa0000-0000-4000-8000-000000000001',
  'earn', 1, 401 + i, 'purchase', 'Filler ' || i,
  pg_catalog.now() + (i || ' minutes')::interval
FROM generate_series(1, 11) AS i;

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012'
   ) AS result,
   LATERAL jsonb_array_elements(result -> 'transactions') AS value
   WHERE value ->> 'type' = 'redemption'
     AND value ->> 'description' = 'Redeemed: Old receipt perk'),
  'unused receipt fell out of the history window'
);
