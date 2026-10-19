-- RDM collision reconciliation on claim release (migration
-- 20261010000026): a merchant code colliding with a redemption stays
-- active while the claim is live, stops shadowing the code when the
-- claiming order cancels, and also reconciles when a redemption is
-- left stamped to a terminally cancelled order.
ALTER TABLE public.discount_codes
  DISABLE TRIGGER discount_codes_no_rdm_prefix;
INSERT INTO public.discount_codes (
  merchant_id, code, discount_type, discount_value
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'RDM-RELEASE1',
  'fixed_amount', 100
), (
  '01aa0000-0000-4000-8000-000000000001', 'RDM-STAMPED1',
  'fixed_amount', 100
);
ALTER TABLE public.discount_codes
  ENABLE TRIGGER discount_codes_no_rdm_prefix;

-- Case 1: claimed by a live order. The merchant code must stay active
-- (the claim is legitimate) until the order cancels.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, total,
  shipping_status, payment_status
) VALUES (
  '01aa0000-0000-4000-8000-000000000041',
  '01aa0000-0000-4000-8000-000000000001', 'LOYALTY-RELEASE-41',
  'Release Probe', 10000, 'pending', 'unpaid'
);
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at,
  minimum_order_amount, expires_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012',
  50, 'discount_fixed', 100, 'RDM-RELEASE1',
  true, '01aa0000-0000-4000-8000-000000000041', pg_catalog.now(),
  0, pg_catalog.now() + interval '30 days'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-RELEASE1' AND is_active IS TRUE
  ),
  'claimed-collision merchant code should stay active while claim is live'
);

UPDATE public.orders
SET shipping_status = 'cancelled'
WHERE id = '01aa0000-0000-4000-8000-000000000041';

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.reward_redemptions
    WHERE discount_code = 'RDM-RELEASE1'
      AND used IS FALSE AND used_on_order_id IS NULL
  ),
  'release clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-RELEASE1' AND is_active IS NOT TRUE
  ),
  'release-reconcile clause failed'
);

-- Case 2: redemption left stamped to an already-cancelled order (the
-- release trigger's SKIP LOCKED gap). Reconciliation now treats it
-- as reusable and deactivates the shadowing merchant code.
INSERT INTO public.orders (
  id, merchant_id, order_number, customer_name, total,
  shipping_status, payment_status
) VALUES (
  '01aa0000-0000-4000-8000-000000000042',
  '01aa0000-0000-4000-8000-000000000001', 'LOYALTY-RELEASE-42',
  'Release Probe', 10000, 'cancelled', 'cancelled'
);
INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, points_spent, reward_type, reward_value,
  discount_code, used, used_on_order_id, used_at,
  minimum_order_amount, expires_at
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012',
  50, 'discount_fixed', 100, 'RDM-STAMPED1',
  true, '01aa0000-0000-4000-8000-000000000042', pg_catalog.now(),
  0, pg_catalog.now() + interval '30 days'
);
SELECT pg_temp.assert_true(
  public.reconcile_rdm_namespace_collisions() >= 1,
  'stamped reconcile count clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-STAMPED1' AND is_active IS NOT TRUE
  ),
  'stamped-reconcile clause failed'
);
