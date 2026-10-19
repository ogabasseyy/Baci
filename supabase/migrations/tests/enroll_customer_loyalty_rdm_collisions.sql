-- Legacy RDM namespace collisions (migration 20261010000025): a
-- merchant discount code minted before the prefix reservation can
-- share an RDM-* value with an outstanding loyalty redemption; the
-- merchant code resolves first at checkout, so reconciliation
-- deactivates it and the paid redemption becomes claimable.
ALTER TABLE public.discount_codes
  DISABLE TRIGGER discount_codes_no_rdm_prefix;
INSERT INTO public.discount_codes (
  merchant_id, code, discount_type, discount_value
) VALUES (
  '01aa0000-0000-4000-8000-000000000001', 'RDM-COLLIDE1',
  'fixed_amount', 100
), (
  '01aa0000-0000-4000-8000-000000000001', 'RDM-NOCOLLIDE',
  'fixed_amount', 100
);
ALTER TABLE public.discount_codes
  ENABLE TRIGGER discount_codes_no_rdm_prefix;

INSERT INTO public.reward_redemptions (
  merchant_id, customer_id, reward_id, points_spent, reward_type,
  reward_value, discount_code, used, expires_at, minimum_order_amount
) VALUES (
  '01aa0000-0000-4000-8000-000000000001',
  '01aa0000-0000-4000-8000-000000000012', NULL, 50, 'discount_fixed',
  100, 'RDM-COLLIDE1', false, pg_catalog.now() + interval '30 days', 0
);

SELECT pg_temp.assert_true(
  public.reconcile_rdm_namespace_collisions() >= 1,
  'reconcile count clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-COLLIDE1' AND is_active IS NOT TRUE
  ),
  'collide clause failed'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM public.discount_codes
    WHERE code = 'RDM-NOCOLLIDE' AND is_active IS TRUE
  ),
  'bystander clause failed'
);

-- Idempotent: a second pass has nothing left to reconcile.
SELECT pg_temp.assert_true(
  public.reconcile_rdm_namespace_collisions() = 0,
  'RDM collision reconciliation was not idempotent'
);
