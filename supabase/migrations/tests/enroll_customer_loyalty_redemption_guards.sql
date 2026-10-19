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
-- A zero maximum-redemption cap refuses the mint before any spend:
-- the code would otherwise be consumed at checkout for no discount.
UPDATE public.loyalty_settings
SET maximum_redemption_percentage = 0
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';
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
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'zero-cap redemption spent points or minted a code'
);
-- Under the same zero cap, a manual-fulfillment reward still redeems:
-- the cap gate is scoped to checkout-discount types.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Zero-cap ship', 100,
  'free_shipping', true
);
SELECT pg_temp.assert_true(
  (SELECT (result ->> 'success')::boolean
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Zero-cap ship')
   ) AS result),
  'zero cap blocked a manual reward'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.reward_redemptions
    WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND reward_name = 'Zero-cap ship'),
  'mint skipped the identity snapshot'
);

-- A valueless plain discount is manual fulfillment too: the cap
-- gate must not block it under the same invalid cap.
UPDATE public.customer_loyalty SET points_balance = 200
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Zero-cap plain', 100,
  'discount', NULL, true
);

SELECT pg_temp.assert_true(
  (SELECT (result ->> 'success')::boolean
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Zero-cap plain')
   ) AS result),
  'zero cap blocked a valueless manual discount'
);

-- Restore the balance the later fractional-fixed case expects.
UPDATE public.customer_loyalty SET points_balance = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

UPDATE public.loyalty_settings
SET maximum_redemption_percentage = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

-- A fixed value below half a unit rounds to a zero checkout discount:
-- reject before deduction so points are never spent on a dead code.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Fractional fixed', 100,
  'discount_fixed', 0.4, true
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Fractional fixed')
   ) AS result)
  AND (SELECT points_balance = 100
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'fractional fixed redemption spent points on a zero discount'
);

-- Manual-fulfillment types redeem end to end: points are spent and a
-- presentable code is minted (checkout still never honors it online).
-- Cost lifted to the 100 program minimum so only the type rule bites.
UPDATE public.loyalty_rewards SET points_cost = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Ship perk';

UPDATE public.customer_loyalty SET points_balance = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND result ->> 'redemption_code' LIKE 'RDM-%'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Ship perk')
   ) AS result),
  'manual-fulfillment redemption did not mint a presentable code'
);

SELECT pg_temp.assert_true(
  (SELECT points_balance = 0
   FROM public.customer_loyalty
   WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
     AND customer_id = '01aa0000-0000-4000-8000-000000000012'),
  'manual-fulfillment redemption spent the wrong points'
);

UPDATE public.loyalty_rewards SET points_cost = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Ship perk';

UPDATE public.customer_loyalty SET points_balance = 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

-- Minimum-bearing manual rewards fail closed at redeem and hide from
-- the catalog: no order context ever enforces their minimum.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Minimum manual', 100,
  'free_shipping', NULL, 5000, true
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Minimum manual')
   ) AS result)
  AND NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000012'
    ) AS status(result),
    LATERAL jsonb_array_elements(status.result -> 'rewards') AS reward
    WHERE reward.value ->> 'name' = 'Minimum manual'
  ),
  'minimum-bearing manual reward redeemed or stayed advertised'
);

-- A valueless plain discount is manual too: the same minimum gate
-- (and catalog hide) applies, or its configured threshold is never
-- enforced anywhere.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Minimum manual discount', 100,
  'discount', NULL, 5000, true
);

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'reward_unavailable'
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Minimum manual discount')
   ) AS result)
  AND NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000012'
    ) AS status(result),
    LATERAL jsonb_array_elements(status.result -> 'rewards') AS reward
    WHERE reward.value ->> 'name' = 'Minimum manual discount'
  ),
  'minimum-bearing manual discount redeemed or stayed advertised'
);

-- Fixed rewards whose value rounds to zero hide from the catalog
-- (redeem rejects them): no affordable-looking dead rewards.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Fractional fixed', 100,
  'discount_fixed', 0.10, true
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000012'
    ) AS status(result),
    LATERAL jsonb_array_elements(status.result -> 'rewards') AS reward
    WHERE reward.value ->> 'name' = 'Fractional fixed'
  ),
  'zero-round fixed reward stayed advertised'
);

-- The effective cap rides in the redemption result so clients can
-- disclose it before and after the spend.
UPDATE public.customer_loyalty SET points_balance = 300
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000012';

INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Capped fifty', 100,
  'discount_percentage', 50, true
);

SELECT pg_temp.assert_true(
  (SELECT (result ->> 'max_redemption_percentage')::numeric = 50
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Capped fifty')
   ) AS result),
  'redemption result omitted the effective cap'
);
