-- Redemption-limit cases for the enroll_customer_loyalty suite (cases 19-22b).
-- Split out of the redemption part (repository 300-line limit): usage
-- caps, the program minimum, expiry reconciliation, and store-credit
-- settlement. Runs in order right after it.

-- 19. Per-customer usage caps bind repeats: a limit-1 reward redeems once,
-- then rejects with usage_limit_reached even though global stock remains.
-- Cost 100 clears the setup program minimum of 100 (the minimum compares
-- against the redeemed cost, not the balance).
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled, stock_quantity,
  usage_limit_per_customer
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'One-time perk', 100, 'discount',
  true, 10, 1
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'One-time perk')
   ) AS result),
  'first capped redemption failed'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'usage_limit_reached'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'One-time perk')
   ) AS result),
  'usage-capped repeat redemption was not rejected'
);

-- Effect asserted separately: AND conjuncts have no guaranteed
-- evaluation order, so a same-statement read can run before the call.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.reward_redemptions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'
     AND reward_id = (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'One-time perk')),
  'rejected capped redemption left a partial mutation'
);

-- 20. The program minimum gates the redeemed cost, not the balance: with
-- minimum 200, a 50-cost reward is rejected even though member 012
-- (balance 50 after case 19) can afford it. available reports the member
-- balance (like insufficient_points) while points_cost carries the
-- attempted cost. Reset after: later cases run under the setup
-- minimum of 100.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Small perk', 50, 'discount', true
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 200
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'minimum_not_met'
     AND (result ->> 'required')::integer = 200
     AND (result ->> 'available')::integer = 50
     AND (result ->> 'points_cost')::integer = 50
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Small perk')
   ) AS result),
  'sub-minimum redemption was not rejected'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 50
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'rejected sub-minimum redemption mutated the balance'
);

UPDATE public.loyalty_settings
SET minimum_redemption_points = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- 21. Expired purchase credits reconcile before the balance check: the
-- past-due earn is marked expired, the balance drops by its points, an
-- expiry ledger row records the write-down, and the redemption then
-- spends from the reconciled balance. (Member 018 enters at 1200.)
-- Backdate the enrollment bonus first: now() is constant inside this
-- transaction, so without this the bonus ties the earn below on
-- created_at and the FIFO lot order flips on random row UUIDs.
UPDATE public.points_transactions
SET created_at = now() - interval '10 days'
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000018'
  AND type = 'bonus';
INSERT INTO public.points_transactions (
  customer_id, merchant_id, type, points, balance_after,
  source, description, expires_at, expired
) VALUES (
  '01aa0000-0000-4000-8000-000000000018',
  '01aa0000-0000-4000-8000-000000000001',
  'earn', 300, 1500, 'purchase', 'Old purchase',
  now() - interval '1 day', NULL
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 700
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Free shipping')
   ) AS result),
  'redemption skipped expiry reconciliation'
);

SELECT pg_temp.assert_true(
  (SELECT expired IS TRUE
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'
     AND type = 'earn'
     AND points = 300)
  AND (SELECT count(*) = 1
   FROM public.points_transactions
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'
     AND type = 'expiry'
     AND points = -300
     AND balance_after = 900
     AND source = 'expiry')
  AND (SELECT points_balance = 700
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'),
  'expiry reconciliation wrote the wrong rows'
);

-- 22. store_credit rewards credit the spendable customer balance in the
-- same transaction instead of stranding a discount code: 500 credit for
-- 100 points. A NULL-valued store_credit reward is misconfigured and
-- fails closed with no mutation.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Credit top-up', 100,
  'store_credit', 500, true
), (
  '01aa0000-0000-4000-8000-000000000001', 'Broken credit', 100,
  'store_credit', NULL, true
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND (result ->> 'new_balance')::integer = 600
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Credit top-up')
   ) AS result),
  'store_credit redemption payload was wrong'
);

-- Effect asserted separately (see case 19): same-statement reads have
-- no guaranteed order relative to the redemption call.
SELECT pg_temp.assert_true(
  (SELECT store_credit = 500
   FROM public.customers
   WHERE id = '01aa0000-0000-4000-8000-000000000018'),
  'store_credit redemption did not credit the customer'
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Broken credit')
   ) AS result)
  AND (SELECT points_balance = 600
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018'),
  'misconfigured store_credit reward was not rejected cleanly'
);

-- 22b. Minimum-gated store credit fails closed: redemption carries no
-- order context and the credit lands in an unconditional balance, so a
-- minimum_order_amount promise is unenforceable. The reward is hidden
-- from status and rejected at redeem time with no mutation.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Gated credit', 100,
  'store_credit', 500, 1000, true
);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false' AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Gated credit')
   ) AS result)
  AND (SELECT points_balance = 600
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000018')
  AND (SELECT store_credit = 500
   FROM public.customers
   WHERE id = '01aa0000-0000-4000-8000-000000000018')
  AND (SELECT NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(result -> 'rewards')
       WHERE value ->> 'name' = 'Gated credit'
     )
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018'
   ) AS result),
  'minimum-gated store credit was honored, mutated, or advertised'
);
