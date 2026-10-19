-- Issuance-minimum snapshot case for the enroll_customer_loyalty
-- suite. Split out of the redemption file (repository 300-line
-- limit); runs immediately after it in the same transaction.

-- The mint snapshots the issuance minimum: a valued checkout
-- discount carrying 2500 stamps it onto the redemption row, so a
-- later reward edit cannot rewrite the issued code's terms. (The
-- valueless Free shipping fixture no longer carries a minimum: under
-- the manual classification it would be unredeemable with one.)
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'Snapshot minimum perk', 100,
  'discount_fixed', 1000, 2500, true
);

-- Fund exactly the 100-point spend so the stored balance (and the
-- downstream limits arithmetic built on it) is unchanged afterwards.
UPDATE public.customer_loyalty
SET points_balance = points_balance + 100
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000018';

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000108');

SELECT pg_temp.assert_true(
  (SELECT (result ->> 'success')::boolean
   FROM public.redeem_loyalty_reward(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000018',
     (SELECT id FROM public.loyalty_rewards
      WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
        AND name = 'Snapshot minimum perk')
   ) AS result),
  'snapshot minimum perk did not redeem'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM public.reward_redemptions rr
    JOIN public.loyalty_rewards rw ON rw.id = rr.reward_id
    WHERE rw.merchant_id = '01aa0000-0000-4000-8000-000000000001'
      AND rw.name = 'Snapshot minimum perk'
      AND rr.minimum_order_amount = 2500
  ),
  'redemption did not snapshot the issuance minimum'
);
