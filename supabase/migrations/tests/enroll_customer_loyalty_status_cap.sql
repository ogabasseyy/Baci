-- Invalid-cap catalog cases (15g), split from the status file for
-- the 300-line limit. Runs right after it: fixtures and auth context
-- carry over, and the cap/perk mutations below are restored inline.
-- 15g. An invalid program cap hides checkout discounts only:
-- redeem refuses them with reward_unavailable, so the catalog must
-- not offer an enabled Redeem button that can never succeed, while
-- manual rewards (valueless 'Free shipping') never read the cap.
UPDATE public.loyalty_rewards SET enabled = true
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Checkout minimum perk';

UPDATE public.loyalty_settings
SET maximum_redemption_percentage = 0
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000011'
    ) AS result,
    LATERAL jsonb_array_elements(result -> 'rewards') AS value
    WHERE value ->> 'name' = 'Checkout minimum perk'
  )
  AND EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000011'
    ) AS result,
    LATERAL jsonb_array_elements(result -> 'rewards') AS value
    WHERE value ->> 'name' = 'Free shipping'
  ),
  'zero cap kept checkout discounts or hid manual rewards'
);

UPDATE public.loyalty_settings
SET maximum_redemption_percentage = 150
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.get_loyalty_status(
      '01aa0000-0000-4000-8000-000000000001',
      '01aa0000-0000-4000-8000-000000000011'
    ) AS result,
    LATERAL jsonb_array_elements(result -> 'rewards') AS value
    WHERE value ->> 'name' = 'Checkout minimum perk'
  ),
  'over-100 cap kept checkout discounts in the catalog'
);

UPDATE public.loyalty_settings
SET maximum_redemption_percentage = 50
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001';
UPDATE public.loyalty_rewards SET enabled = false
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND name = 'Checkout minimum perk';
