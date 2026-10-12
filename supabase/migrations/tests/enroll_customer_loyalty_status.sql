-- Status cases for the enroll_customer_loyalty suite (cases 12-14).

-- 12. Status fail-closes on program/customer/ownership.
UPDATE public.loyalty_settings
SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'program_unavailable'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'status did not fail closed on a disabled program'
);

UPDATE public.loyalty_settings
SET enabled = true
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000099'
   ) AS result),
  'status did not fail closed on an unknown customer'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'customer_not_found'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'cross-customer status disclosed membership'
);

-- 13. A non-enrolled customer gets zeros plus the live catalog.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000106');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'enrolled')::boolean IS FALSE
     AND (result ->> 'points_balance')::integer = 0
     AND (result ->> 'lifetime_points')::integer = 0
     AND result ->> 'current_tier' = 'Bronze'
     AND jsonb_array_length(result -> 'rewards') = 1
     AND result -> 'rewards' -> 0 ->> 'name' = 'Free shipping'
     AND (result -> 'rewards' -> 0 ->> 'points_cost')::integer = 200
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Sold-out perk'
     )
     AND jsonb_array_length(result -> 'transactions') = 0
     AND jsonb_array_length(result -> 'tiers') = 4
     AND (result -> 'referral_code') = 'null'::jsonb
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000016'
   ) AS result),
  'non-enrolled status returned the wrong projection'
);

-- 14. An enrolled customer gets balances, catalog, and recent transactions.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'enrolled')::boolean IS TRUE
     AND (result ->> 'points_balance')::integer = 100
     AND (result ->> 'lifetime_points')::integer = 100
     AND result ->> 'current_tier' = 'Bronze'
     AND length(result ->> 'referral_code') = 8
     AND (result ->> 'referral_code') = (
       SELECT referral_code FROM public.customer_loyalty
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND customer_id = '01aa0000-0000-4000-8000-000000000011'
     )
     AND jsonb_array_length(result -> 'rewards') = 1
     AND jsonb_array_length(result -> 'transactions') = 2
     AND (SELECT count(*)
       FROM jsonb_array_elements(result -> 'transactions')
       WHERE value ->> 'type' = 'referral') = 1
     AND (SELECT count(*)
       FROM jsonb_array_elements(result -> 'transactions')
       WHERE value ->> 'type' = 'bonus') = 1
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result),
  'enrolled status returned the wrong projection'
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND result ->> 'current_tier' = 'Silver'
     AND (result ->> 'lifetime_points')::integer = 1500
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015'
   ) AS result),
  'tier-crossing status returned the wrong tier'
);

-- 15. The catalog projection surfaces minimum_order_amount so the UI can
-- disclose the checkout minimum before the customer spends points.
UPDATE public.loyalty_rewards
SET minimum_order_amount = 2500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Free shipping';

-- Member 011 belongs to user 101 (same caller as case 14): the status
-- function rejects cross-owner reads, so re-auth past case 14b's 105.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT (value ->> 'minimum_order_amount')::numeric = 2500
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result,
   LATERAL jsonb_array_elements(result -> 'rewards') AS value
   WHERE value ->> 'name' = 'Free shipping'),
  'status projection dropped minimum_order_amount'
);

-- 15b. Duplicate tier names collapse to the lowest threshold (mirroring
-- the route's dedupeLadderByName): last-match-wins would oscillate
-- Silver -> Gold -> Silver as points grow past the second Silver rung.
UPDATE public.loyalty_settings
SET tiers = '[{"name": "Silver", "minPoints": 1000}, {"name": "Silver", "minPoints": 5000}, {"name": "Gold", "minPoints": 3000}, {"name": "Platinum", "minPoints": 10000}]'::jsonb
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  public.calculate_loyalty_tier(
    6000, '01aa0000-0000-4000-8000-000000000001'
  ) = 'Gold',
  'duplicate tier names did not collapse to the lowest threshold'
);

UPDATE public.loyalty_settings
SET tiers = DEFAULT
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 15c. History carries the issued code as a recovery receipt: a capped
-- reward leaves the catalog once its redemption response is lost, so
-- the redemption transaction surfaces the code for later recovery.
INSERT INTO public.reward_redemptions (
  id, customer_id, merchant_id, points_spent, reward_type,
  reward_value, discount_code
) VALUES (
  '01aa0000-0000-4000-8000-00000000015c',
  '01aa0000-0000-4000-8000-000000000011',
  '01aa0000-0000-4000-8000-000000000001',
  100, 'discount', 500, 'RDM-STATUS15C'
);

INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, source_id, description
) VALUES (
  '01aa0000-0000-4000-8000-000000000011',
  '01aa0000-0000-4000-8000-000000000001',
  'redemption', -100, 200, 'redemption',
  '01aa0000-0000-4000-8000-00000000015c', 'Redeemed: Big perk'
);

SELECT pg_temp.assert_true(
  (SELECT value ->> 'redemption_code' = 'RDM-STATUS15C'
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011'
   ) AS result,
   LATERAL jsonb_array_elements(result -> 'transactions') AS value
   WHERE value ->> 'type' = 'redemption'
     AND value ->> 'description' = 'Redeemed: Big perk'),
  'history dropped the issued redemption code'
);

-- Fixture cleanup: the FIFO projection cases walk member 011's ledger,
-- so the receipt rows above must not leak into later files.
DELETE FROM public.points_transactions
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000011'
  AND source = 'redemption'
  AND source_id = '01aa0000-0000-4000-8000-00000000015c';
DELETE FROM public.reward_redemptions
WHERE id = '01aa0000-0000-4000-8000-00000000015c';
