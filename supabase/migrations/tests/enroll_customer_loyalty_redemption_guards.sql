-- Redemption-guard cases for the enroll_customer_loyalty suite (case
-- 32). Runs last: fixtures are self-contained and nothing runs after.
--
-- 32. Over-100% percentage rewards fail closed: redeem rejects and status
-- hides (checkout caps at the subtotal, so 150% advertises a lie).
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Wild percent', 100,
  'discount_percentage', 150, true
);

UPDATE public.customer_loyalty SET points_balance = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Wild percent')
   ) AS result)
  AND (SELECT points_balance = 100
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012')
  AND NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000012'
    ) AS status(result),
    LATERAL jsonb_array_elements(status.result -> 'rewards') AS reward
    WHERE reward.value ->> 'name' = 'Wild percent'
  ),
  'over-100% reward redeemed or stayed advertised'
);
