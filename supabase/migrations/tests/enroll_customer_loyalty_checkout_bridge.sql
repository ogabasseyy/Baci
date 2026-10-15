-- Checkout-bridge cases (24a-25c): discount RDM-* codes resolve and
-- the order wrapper claims them atomically. Member 024 funds fixtures.
INSERT INTO public.loyalty_rewards (
  merchant_id, name, points_cost, reward_type, reward_value,
  minimum_order_amount, enabled
) VALUES
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge fixed', 100,
   'discount_fixed', 1000, 5000, true),
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge percent', 100,
   'discount_percentage', 10, NULL, true),
  ('01aa0000-0000-4000-8000-000000000001', 'Bridge credit', 100,
   'store_credit', 500, NULL, true);

SELECT id AS fixed_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge fixed' \gset
SELECT id AS percent_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge percent' \gset
SELECT id AS credit_reward_id FROM public.loyalty_rewards WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND name = 'Bridge credit' \gset

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000113');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'fixed_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'percent_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

SELECT public.redeem_loyalty_reward(
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000024',
  :'credit_reward_id',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');

SELECT discount_code AS fixed_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'fixed_reward_id' \gset
SELECT discount_code AS percent_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'percent_reward_id' \gset
SELECT discount_code AS credit_code FROM public.reward_redemptions WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001' AND customer_id = '01aa0000-0000-4000-8000-000000000024' AND reward_id = :'credit_reward_id' \gset

-- 24a. A discount-typed code resolves with its snapshot terms.
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'discount_fixed'
     AND row.reward_value = 1000
     AND row.minimum_order_amount = 5000
     AND row.used IS FALSE
     AND row.issuance_currency = 'NGN'
     AND row.max_redemption_percentage = 50
     AND row.reward_name = 'Bridge fixed'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'fixed_code'
   ) AS row),
  'discount-typed loyalty code did not resolve with terms'
);

-- 24b. Unknown codes resolve to no row (the routes answer invalid).
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.get_loyalty_redemption_for_checkout(
      '01aa0000-0000-4000-8000-000000000001', 'RDM-NOPE'
    )
  ),
  'unknown code resolved a loyalty row'
);

-- 24c. Matching is case-insensitive like the discount-code resolve.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     lower(:'percent_code')
   )),
  'lowercase loyalty code did not resolve'
);

-- 24d. Non-discount types resolve too (routes/wrapper filter).
SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'store_credit'
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'credit_code'
   ) AS row),
  'store_credit code did not resolve for layer filtering'
);

-- 24e. Used codes still resolve with used=true (wrapper enforces).
UPDATE public.reward_redemptions
SET used = true, used_at = pg_catalog.now()
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND customer_id = '01aa0000-0000-4000-8000-000000000024'
  AND reward_id = :'percent_reward_id';

SELECT pg_temp.assert_true(
  (SELECT row.used IS TRUE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'percent_code'
   ) AS row),
  'used loyalty code did not resolve with used=true'
);

-- 24f. A disabled reward does not void its issued codes.
UPDATE public.loyalty_rewards SET enabled = false
WHERE id = :'fixed_reward_id';

SELECT pg_temp.assert_true(
  (SELECT row.reward_type = 'discount_fixed'
     AND row.reward_value = 1000
     AND row.minimum_order_amount = 5000
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'fixed_code'
   ) AS row),
  'disabled reward voided its issued code'
);

UPDATE public.loyalty_rewards SET enabled = true
WHERE id = :'fixed_reward_id';

-- 24g. A no-minimum mint survives a later merchant minimum.
UPDATE public.loyalty_rewards SET minimum_order_amount = 5000
WHERE id = :'percent_reward_id';
SELECT pg_temp.assert_true(
  (SELECT row.minimum_order_amount = 0
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001',
     :'percent_code'
   ) AS row),
  'no-minimum code inherited the raised live minimum'
);
UPDATE public.loyalty_rewards SET minimum_order_amount = NULL
WHERE id = :'percent_reward_id';

-- 24h. The issuance stamp freezes at mint (a payout flip cannot move it).
UPDATE public.merchants SET payout_currency = 'USD' WHERE id = '01aa0000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT public.merchant_resolved_currency('01aa0000-0000-4000-8000-000000000001') = 'USD')
  AND (SELECT row.issuance_currency = 'NGN' FROM public.get_loyalty_redemption_for_checkout('01aa0000-0000-4000-8000-000000000001', :'fixed_code') AS row),
  'issuance currency moved after a payout currency flip');
UPDATE public.merchants SET payout_currency = 'NGN' WHERE id = '01aa0000-0000-4000-8000-000000000001';

-- 25a. The order wrapper rejects a NULL redemption id before touching
-- the order RPC.
DO $$
BEGIN
  PERFORM public.create_storefront_order_with_loyalty_code(
    '01aa0000-0000-4000-8000-000000000001', 'bridge@example.com',
    'Bridge Shopper', '[]'::jsonb
  );
  RAISE EXCEPTION 'null redemption id did not raise';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%loyalty_redemption_required%' THEN
      RAISE EXCEPTION 'wrong error for null redemption id: %', SQLERRM;
    END IF;
END $$;

-- 25b. The order wrapper rejects an unknown redemption id before
-- touching the order RPC.
DO $$
BEGIN
  PERFORM public.create_storefront_order_with_loyalty_code(
    '01aa0000-0000-4000-8000-000000000001', 'bridge@example.com',
    'Bridge Shopper', '[]'::jsonb,
    NULL, 0, 0, 0, 'card', 'unpaid', 'pending', NULL, 'online_store',
    NULL, NULL, NULL, NULL, NULL, NULL, 'exclusive', 0, NULL, NULL,
    NULL, '01aa0000-0000-4000-8000-000000000099'
  );
  RAISE EXCEPTION 'unknown redemption id did not raise';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%loyalty_redemption_not_found%' THEN
      RAISE EXCEPTION 'wrong error for unknown redemption id: %', SQLERRM;
    END IF;
END $$;
