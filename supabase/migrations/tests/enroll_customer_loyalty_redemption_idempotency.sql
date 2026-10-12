-- Redemption-idempotency cases for the enroll_customer_loyalty suite
-- (cases 23a-23d). Runs after the redemption limits: a lost-response
-- retry replays the stored success instead of minting a second
-- redemption. Fresh member 024 stays out of every other case (case 20
-- needs member 018 at exactly 600).
INSERT INTO public.customers (id, merchant_id, email, user_id)
VALUES (
  '01aa0000-0000-4000-8000-000000000024',
  '01aa0000-0000-4000-8000-000000000001',
  'idempotent@example.com',
  '01aa0000-0000-4000-8000-000000000113'
);

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Idempotent perk', 100,
   'discount', true),
  ('01aa0000-0000-4000-8000-000000000001', 'Other perk', 100,
   'discount', true),
  ('01aa0000-0000-4000-8000-000000000001', 'Too pricey', 501,
   'discount', true);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');
SELECT public.enroll_customer_loyalty(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024', NULL);

UPDATE public.customer_loyalty
SET points_balance = 500, lifetime_points = 500
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024';

-- 23a. A retry under the same key replays the stored success: same
-- code, no second deduction, a single redemption row.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'keyed first redemption failed'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 400
     AND result ->> 'redemption_code' = (
       SELECT discount_code FROM public.reward_redemptions
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND customer_id = '01aa0000-0000-4000-8000-000000000024'
     )
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result)
  AND (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024')
  AND (SELECT points_balance = 400
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'),
  'same-key retry did not replay without re-spending'
);

-- 23b. The same key with a different reward is a changed intent, not a
-- retry: rejected with no mutation.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'idempotency_key_reused'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Other perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result)
  AND (SELECT points_balance = 400
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'),
  'key reuse with a different reward was not rejected cleanly'
);

-- 23c. A key replayed by a different customer is rejected before any
-- other check (the replay guard precedes ownership).
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000105');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'idempotency_key_mismatch'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000015',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Idempotent perk'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'cross-customer key replay was not rejected'
);

-- 23d. Failures are never stored: an insufficient-points attempt under
-- a key retries as a fresh attempt after a top-up, then replays.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'insufficient_points'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Too pricey'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'keyed insufficient-points attempt did not fail cleanly'
);

UPDATE public.customer_loyalty
SET points_balance = 1000
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 499
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Too pricey'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result),
  'retry after top-up did not succeed fresh under the same key'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 499
     AND result ->> 'redemption_code' = (
       SELECT discount_code FROM public.reward_redemptions
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND customer_id = '01aa0000-0000-4000-8000-000000000024'
         AND reward_id = (
           SELECT id FROM public.loyalty_rewards
           WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
             AND name = 'Too pricey'
         )
     )
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Too pricey'),
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
   ) AS result)
  AND (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000024'
     AND reward_id = (
       SELECT id FROM public.loyalty_rewards
       WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
         AND name = 'Too pricey'
     )),
  'post-top-up retry did not store and replay'
);

-- 23e. The idempotency receipt survives its reward row: deleting the
-- reward SET NULLs the receipt instead of cascading it, so a
-- lost-response retry still replays the original success (the stored
-- new_balance 400) instead of failing reward_unavailable after the
-- points were already consumed. No later case uses 'Idempotent perk'.
SELECT id AS doomed_reward_id
FROM public.loyalty_rewards
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Idempotent perk' \gset

DELETE FROM public.loyalty_rewards WHERE id = :'doomed_reward_id';

SELECT pg_temp.assert_true(
  (SELECT reward_id IS NULL
   FROM public.loyalty_redemption_idempotency_keys
   WHERE key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'reward delete cascaded the idempotency receipt'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 400
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000024',
     :'doomed_reward_id',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
   ) AS result),
  'post-delete retry did not replay the stored success'
);

-- Every idempotency-table foreign key has a covering index: without a
-- merchant- or reward-leading index, merchant/reward deletes scan the
-- growing table to enforce their cascades.
SELECT pg_temp.assert_true(
  pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_idempotency_keys_merchant_idx'::pg_catalog.regclass
  ) LIKE '%(merchant_id)%'
  AND pg_catalog.pg_get_indexdef(
    'public.loyalty_redemption_idempotency_keys_reward_idx'::pg_catalog.regclass
  ) LIKE '%(reward_id)%',
  'idempotency foreign keys lack covering indexes'
);
