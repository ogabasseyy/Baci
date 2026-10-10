-- Status projection and cap cases for the enroll_customer_loyalty suite
-- (cases 27-28d). Runs after redemption: the cap and minimum cases
-- depend on case-19 and case-25 state, and case 27 mutates member 011
-- balances no later case depends on.

-- 27. Status projects the spendable balance without writing: member 011
-- holds 300 materialized with a 200-point expired lot and no redemption
-- yet, so status reports 100 while the row and the lot stay untouched.
UPDATE public.customer_loyalty
SET points_balance = 300, lifetime_points = 300
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000011';

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, expires_at, created_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000011',
  '01aa0000-0000-4000-8000-000000000001',
  'earn', 200, 300, 'purchase', 'Old purchase',
  now() - interval '1 day', now() - interval '3 days'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'points_balance')::integer = 100
     AND (result ->> 'lifetime_points')::integer = 300
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Big perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'status advertised the unreconciled balance'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 300
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011')
  AND (SELECT expired IS NOT TRUE
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000011'
     AND type = 'earn'
     AND points = 200),
  'status projection wrote through to the ledger'
);

-- 28. Status hides rewards the caller exhausted: member 012 redeemed the
-- limit-1 One-time perk in case 19, so it disappears from 012's catalog
-- (but stays for unenrolled 016 — the cap binds per customer).
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'One-time perk'
     )
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Free shipping'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012'
   ) AS result),
  'status re-advertised a capped reward'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000106');

SELECT pg_temp.assert_true(
  (SELECT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'One-time perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016'
   ) AS result),
  'uncapped customer lost sight of a capped reward'
);

-- 28b. Status hides rewards below the program minimum: with minimum 500,
-- member 018 (balance 100 after case 25) can afford Cheap perk but never
-- redeem it, so it disappears from the catalog while the 500-cost Big
-- perk stays (unaffordable, but not minimum-barred). Restored after.
UPDATE public.loyalty_settings
SET minimum_redemption_points = 500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' IN ('Cheap perk', 'Free shipping')
     )
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Big perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018'
   ) AS result),
  'status advertised a minimum-barred reward'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 28c. Unsupported reward types are rejected before any mutation and
-- hidden from status: the merchant PATCH endpoint stores reward_type
-- without an allowlist, but redemption has no fulfillment for unknown
-- types. (Member 015 is untouched by later cases.)
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled, stock_quantity
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Mystery perk', 100,
  'mystery', true, 5
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Mystery perk')
   ) AS result),
  'unknown reward type was redeemable'
);

SELECT pg_temp.assert_true(
  (SELECT stock_quantity = 5
   FROM public.loyalty_rewards
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND name = 'Mystery perk')
  AND (SELECT points_balance = 1400
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000015')
  AND (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Mystery perk'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015'
   ) AS result),
  'unknown reward type left a mutation or stayed advertised'
);

-- 28d. Valued rewards without a positive value are hidden from status
-- (same predicate as the redemption RPC's valued guard): a null, zero,
-- or negative store_credit / discount_fixed / discount_percentage
-- always fails closed at redeem time, so it must not be offered. A
-- plain discount without a value stays listed: it is redeemable.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  enabled, stock_quantity
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Empty credit', 100,
   'store_credit', NULL, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Zero fixed', 100,
   'discount_fixed', 0, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Negative percent', 100,
   'discount_percentage', -10, true, 5),
  ('01aa0000-0000-4000-8000-000000000001', 'Valueless discount', 100,
   'discount', NULL, true, 5);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' IN (
         'Empty credit', 'Zero fixed', 'Negative percent'
       )
     )
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Valueless discount'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015'
   ) AS result),
  'unvalued valued-reward stayed advertised or plain discount hid'
);
