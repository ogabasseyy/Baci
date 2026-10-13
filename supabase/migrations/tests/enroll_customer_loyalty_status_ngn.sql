-- Manual-type catalog and store-credit currency cases (15d-15e),
-- split from the status file for the 300-line limit.
-- 15d. Manual-fulfillment types stay in the catalog: they mint a
-- present-the-code redemption even though checkout never honors them
-- (the spend itself is asserted in the guards suite). The cost is
-- lifted over the program minimum first so only the type rule bites.
UPDATE public.loyalty_rewards SET points_cost = 150
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Ship perk';

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000011'
    ) AS result,
    LATERAL jsonb_array_elements(result -> 'rewards') AS value
    WHERE value ->> 'name' = 'Ship perk'
  ),
  'manual-fulfillment reward type left the catalog'
);
UPDATE public.loyalty_rewards SET points_cost = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Ship perk';

-- 15e. Store credit is NGN-only (wallet cannot spend it off-NGN).
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  -- Cost 100 meets the program minimum, so the attempt reaches the
  -- NGN guard instead of failing minimum_not_met first.
  '01aa0000-0000-4000-8000-000000000001', 'NGN probe', 100,
  'store_credit', 500, true
);

SELECT id AS probe_reward_id FROM public.loyalty_rewards
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'NGN probe' \gset

-- Flip merchants as the fixture owner (RLS), then drop back.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000107');
UPDATE public.merchants SET payout_currency = 'USD'
WHERE id = '01aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT payout_currency = 'USD'
   FROM public.merchants
   WHERE id = '01aa0000-0000-4000-8000-000000000001'),
  'payout flip did not apply'
);

SELECT pg_temp.assert_true(
  NOT public.merchant_resolves_to_ngn(
    '01aa0000-0000-4000-8000-000000000001'
  ),
  'helper misresolved the USD merchant'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000011',
     :'probe_reward_id'
   ) AS result),
  'non-NGN store credit redeemed'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000011'
    ) AS result,
    LATERAL jsonb_array_elements(result -> 'rewards') AS value
    WHERE value ->> 'name' = 'NGN probe'
  ),
  'non-NGN store credit reached the catalog'
);

-- Restore the NGN default: later files assume an NGN merchant.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000107');
UPDATE public.merchants SET payout_currency = DEFAULT
WHERE id = '01aa0000-0000-4000-8000-000000000001';
DELETE FROM public.loyalty_rewards
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'NGN probe';
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');
