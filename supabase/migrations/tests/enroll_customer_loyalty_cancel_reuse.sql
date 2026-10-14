-- Cancelled-claim reuse cases for the enroll_customer_loyalty suite
-- (case 34). Runs last: fixtures are self-contained and nothing runs
-- after.
--
-- 34. A claim stamped to a cancelled order resolves as reusable: the
-- release trigger skips rows locked by an in-flight retry, so the
-- resolver reports effective used=false and validation unblocks. (The
-- wrapper re-verifies under lock before claiming.)
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, total, shipping_status)
VALUES ('01aa0000-0000-4000-8000-000000000034', '01aa0000-0000-4000-8000-000000000001', 'LOYALTY-REUSE-34', 'Reuse Probe', 10000, 'cancelled');
RESET ROLE;
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', '01aa0000-0000-4000-8000-000000000012',
  50, 'discount_fixed', 500, 'RDM-REUSE34',
  true, '01aa0000-0000-4000-8000-000000000034', pg_catalog.now()
);
SELECT pg_temp.assert_true(
  (SELECT row.used IS FALSE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-REUSE34'
   ) AS row),
  'claim on a cancelled order did not resolve as reusable'
);

-- 34b. The reusable claim also stays recoverable from history after
-- newer transactions push its receipt out of the recent window: the
-- receipts union applies the same cancelled-order effective-used rule.
INSERT INTO public.points_transactions (
  merchant_id, customer_id, points, type, description, source,
  source_id, balance_after, created_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', -50, 'redemption',
  'Redeemed: Reuse perk', 'redemption',
  (SELECT id::text FROM public.reward_redemptions
   WHERE discount_code = 'RDM-REUSE34'), 0,
  pg_catalog.now() - interval '1 hour'
);

INSERT INTO public.points_transactions (
  merchant_id, customer_id, points, type, description, balance_after,
  source
)
SELECT '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', 1, 'earn', 'Filler', 0,
  'purchase'
FROM pg_catalog.generate_series(1, 11);

SELECT pg_temp.as_user('01aa0000-0000-4000-8000-000000000102');

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.get_loyalty_status(
     '01aa0000-0000-4000-8000-000000000001',
     '01aa0000-0000-4000-8000-000000000012'
   ) AS result,
   LATERAL jsonb_array_elements(result -> 'transactions') AS value
   WHERE value ->> 'redemption_code' = 'RDM-REUSE34'),
  'cancelled-claim receipt fell out of history recovery'
);

-- 34c. Payment-only cancellation (mark_abandoned_orders sets only
-- payment_status) also releases: the trigger watches both fields and
-- the resolver treats either as effective cancellation.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, total, shipping_status, payment_status)
VALUES ('01aa0000-0000-4000-8000-000000000035', '01aa0000-0000-4000-8000-000000000001', 'LOYALTY-REUSE-35', 'Reuse Probe', 10000, 'pending', 'unpaid');
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', '01aa0000-0000-4000-8000-000000000012',
  50, 'discount_fixed', 500, 'RDM-REUSE35',
  true, '01aa0000-0000-4000-8000-000000000035', pg_catalog.now()
);
UPDATE public.orders SET payment_status = 'cancelled'
WHERE id = '01aa0000-0000-4000-8000-000000000035';
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT used IS FALSE AND used_on_order_id IS NULL
   FROM public.reward_redemptions WHERE discount_code = 'RDM-REUSE35')
  AND (SELECT row.used IS FALSE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-REUSE35'
   ) AS row),
  'payment-only cancellation did not release the claim'
);

-- 34d. The US spelling 'canceled' is terminal too (the order update
-- schema accepts both): it releases and makes the code reusable.
SET ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, total, shipping_status)
VALUES ('01aa0000-0000-4000-8000-000000000036', '01aa0000-0000-4000-8000-000000000001', 'LOYALTY-REUSE-36', 'Reuse Probe', 10000, 'pending');
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', '01aa0000-0000-4000-8000-000000000012',
  50, 'discount_fixed', 500, 'RDM-REUSE36',
  true, '01aa0000-0000-4000-8000-000000000036', pg_catalog.now()
);
UPDATE public.orders SET shipping_status = 'canceled'
WHERE id = '01aa0000-0000-4000-8000-000000000036';
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT used IS FALSE AND used_on_order_id IS NULL
   FROM public.reward_redemptions WHERE discount_code = 'RDM-REUSE36')
  AND (SELECT row.used IS FALSE
   FROM public.get_loyalty_redemption_for_checkout(
     '01aa0000-0000-4000-8000-000000000001', 'RDM-REUSE36'
   ) AS row),
  'US-spelled cancellation did not release the claim'
);

-- 34e. The gateway payment-completion wrapper already treats both
-- cancellation spellings as terminal before delegating to its _v1
-- promotion path (20260928183100), so a released claim cannot be
-- resurrected by a late gateway payment. Definition-pinned: the
-- terminal check must precede the _v1 delegation.
SELECT pg_temp.assert_true(
  (SELECT strpos(def, 'IN (''canceled'', ''cancelled'')') > 0
     AND strpos(def, 'IN (''canceled'', ''cancelled'')')
       < strpos(def, 'complete_order_gateway_payment_v1(')
   FROM pg_catalog.pg_get_functiondef(
     'public.complete_order_gateway_payment(uuid,uuid,jsonb,text,bigint)'::pg_catalog.regprocedure
   ) AS def),
  'gateway payment completion can reopen a canceled order'
);
