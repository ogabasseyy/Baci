-- Reconcile legacy RDM namespace collisions (issue #3165): migration
-- 10 reserved the RDM- prefix for loyalty redemptions, but a merchant
-- discount code and an outstanding loyalty redemption minted before
-- the reservation can already share one RDM-* value for a merchant.
-- Checkout resolves the merchant code first, so the customer's paid
-- loyalty code would apply the reusable promotion and never be
-- claimed. Deactivate the merchant code wherever it shadows an
-- unused, unclaimed redemption (the merchant can recreate the
-- promotion under a non-reserved code; the paid redemption keeps the
-- code the customer holds). Wrapped in a function so the replay
-- suite can exercise the reconciliation against fresh fixtures.
CREATE OR REPLACE FUNCTION public.reconcile_rdm_namespace_collisions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.discount_codes AS dc
  SET is_active = false
  WHERE dc.is_active IS TRUE
    AND pg_catalog.upper(dc.code) LIKE 'RDM-%'
    AND EXISTS (
      SELECT 1
      FROM public.reward_redemptions AS rr
      WHERE rr.merchant_id = dc.merchant_id
        AND pg_catalog.upper(rr.discount_code) = pg_catalog.upper(dc.code)
        AND rr.used IS NOT TRUE
        AND rr.used_on_order_id IS NULL
        AND (rr.expires_at IS NULL OR rr.expires_at > pg_catalog.now())
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_rdm_namespace_collisions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_rdm_namespace_collisions()
  TO service_role;

DO $$
DECLARE
  v_reconciled integer;
BEGIN
  v_reconciled := public.reconcile_rdm_namespace_collisions();
  IF v_reconciled > 0 THEN
    RAISE NOTICE 'deactivated % merchant discount code(s) shadowing loyalty redemptions', v_reconciled;
  END IF;
END;
$$;
