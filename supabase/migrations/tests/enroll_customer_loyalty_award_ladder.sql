-- Ladder-multiplier award cases for the enroll_customer_loyalty suite
-- (cases 5j-5l). Split out of the purchase-award file (repository
-- 300-line limit); runs immediately after it against the same 02aa
-- fixtures and transaction.

-- 5j. The purchase multiplier follows the tier calculator's dedup: with
-- duplicate Silver rungs (5k at 2x stored before 1k at 1.25x) a
-- 1500-point member earns at 1.25x, not the raw-first 2x.
UPDATE public.customer_loyalty
SET lifetime_points = 1500, current_tier = 'Silver'
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
  AND customer_id = '02aa0000-0000-4000-8000-000000000011';
UPDATE public.loyalty_settings
SET tiers = '[{"name":"Silver","minPoints":5000,"multiplier":2},{"name":"Silver","minPoints":1000,"multiplier":1.25}]'::jsonb
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a7',
    10000
  ) = 125,
  'award used the wrong duplicate tier multiplier'
);
UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

-- 5k. The multiplier follows the tier derived from current lifetime,
-- not the stored name: after a ladder edit the stored tier is stale,
-- so a 1500-point member stored as Bronze still earns the Silver rate.
UPDATE public.customer_loyalty
SET lifetime_points = 1500, points_balance = 0, current_tier = 'Bronze'
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
  AND customer_id = '02aa0000-0000-4000-8000-000000000011';
UPDATE public.loyalty_settings
SET tiers = '[{"name":"Bronze","minPoints":0,"multiplier":1},{"name":"Silver","minPoints":1000,"multiplier":2}]'::jsonb
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a8',
    10000
  ) = 200,
  'award used the stale stored tier multiplier'
);
UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';

-- 5l. Invalid ladder rungs carry no multiplier: with only an invalid
-- Bronze rung (null threshold at 10x), the calculator falls back to
-- Bronze and the award must use 1x, not the invalid rung's rate.
UPDATE public.customer_loyalty
SET lifetime_points = 100, points_balance = 0, current_tier = 'Bronze'
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001'
  AND customer_id = '02aa0000-0000-4000-8000-000000000011';
UPDATE public.loyalty_settings
SET tiers = '[{"name":"Bronze","minPoints":null,"multiplier":10}]'::jsonb
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  public.award_purchase_points(
    '02aa0000-0000-4000-8000-000000000011',
    '02aa0000-0000-4000-8000-000000000001',
    '02aa0000-0000-4000-8000-0000000000a9',
    10000
  ) = 100,
  'award used an invalid ladder rung multiplier'
);
UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '02aa0000-0000-4000-8000-000000000001';
