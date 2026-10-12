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
