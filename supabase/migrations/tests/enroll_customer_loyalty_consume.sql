-- Consume-path cases for manual-fulfillment redemptions (case 35):
-- the merchant-facing single-use enforcement for present-the-code
-- rewards that checkout never honors.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.loyalty_rewards (
  id, merchant_id, name, points_cost, reward_type, enabled
) VALUES (
  '01aa0000-0000-4000-8000-000000000501',
  '01aa0000-0000-4000-8000-000000000001', 'Consume product', 50,
  'free_product', true
);
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, reward_id, points_spent, reward_type,
  reward_value, discount_code, used, expires_at
) VALUES
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000012',
   '01aa0000-0000-4000-8000-000000000501',
   50, 'free_product', NULL,
   'RDM-CONSUME1', NULL, pg_catalog.now() + interval '30 days'),
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'discount', NULL,
   'RDM-CONSUME2', false, pg_catalog.now() + interval '30 days'),
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'discount_fixed', 500,
   'RDM-CONSUME3', false, pg_catalog.now() + interval '30 days'),
  ('01aa0000-0000-4000-8000-000000000001',
   '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'free_shipping', NULL,
   'RDM-CONSUME4', false, pg_catalog.now() - interval '1 day');
RESET ROLE;

-- The merchant owner (user 101 since the adjustment suite) consumes a
-- NULL-used manual code (legacy rows can carry an explicit NULL; the
-- series treats it as unused everywhere).
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND result ->> 'discount_code' = 'RDM-CONSUME1'
     AND result ->> 'reward_name' = 'Consume product'
     AND result ->> 'reward_id'
       = '01aa0000-0000-4000-8000-000000000501'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'rdm-consume1'
   ) AS result),
  'owner could not consume a NULL-used manual code'
);

SELECT pg_temp.assert_true(
  (SELECT used IS TRUE AND used_at IS NOT NULL
   FROM public.reward_redemptions WHERE discount_code = 'RDM-CONSUME1'),
  'consume did not mark the manual code used'
);

-- Lost-response retry: a second consume of a manually consumed code
-- replays the receipt (same identity) instead of erroring, so staff
-- can still fulfill after a dropped response.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
     AND result ->> 'discount_code' = 'RDM-CONSUME1'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME1'
   ) AS result),
  'manual consume retry did not replay the receipt'
);

-- A suspended staff session has no merchant access.
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000104');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'forbidden'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME2'
   ) AS result),
  'suspended staff session consumed a manual code'
);

-- Active staff without marketing:edit are rejected inside the RPC:
-- the DEFINER function is directly reachable, so access alone is not
-- authorization (user 102 is a sales_rep: marketing view only).
SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'forbidden'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME2'
   ) AS result),
  'staff without marketing edit consumed a manual code'
);

-- Grant marketing:edit and the same staff session consumes: the
-- permission, not just the owner row, authorizes the atomic update.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.staff_members
SET permissions = '{"marketing": {"edit": true}}'::jsonb
WHERE merchant_id = '01aa0000-0000-4000-8000-000000000001'
  AND user_id = '01aa0000-0000-4000-8000-000000000102';
RESET ROLE;

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

-- Valueless plain discounts are manual (present-the-code) too.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'true'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME2'
   ) AS result),
  'valueless plain discount could not be consumed'
);

-- Valued checkout codes and expired manual codes stay unconsumable.
SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'redemption_not_found'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME3'
   ) AS result)
  AND (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'redemption_not_found'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME4'
   ) AS result),
  'checkout or expired code was consumed manually'
);

-- A checkout-claimed code (order stamp present) is not replayable
-- through the manual path.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at, expires_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', 50, 'free_product', NULL,
  'RDM-CONSUME5', true, '01aa0000-0000-4000-8000-000000000034',
  pg_catalog.now(), pg_catalog.now() + interval '30 days'
);
RESET ROLE;

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000101');

SELECT pg_temp.assert_true(
  (SELECT result ->> 'success' = 'false'
     AND result ->> 'error' = 'redemption_not_found'
   FROM public.consume_loyalty_redemption(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-CONSUME5'
   ) AS result),
  'checkout-claimed code replayed through the manual path'
);
