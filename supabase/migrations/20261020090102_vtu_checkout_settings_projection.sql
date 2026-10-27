-- Allowlisted VTU checkout settings projection (epic #3694
-- Phase 2).
--
-- merchant_feature_settings is secret-bearing (anon SELECT revoked;
-- buyers have no table policy — the unified policy is
-- merchant-owner/staff only). The checkout needs 11 columns, so it
-- reads them here instead of the base table (the 20260714010000
-- projections rule). The 6 VTU flags are also public via
-- get_storefront_vtu_settings; the MEMBERSHIP gate below exists for
-- the commission/cashback rates, which are business-sensitive and
-- must never be enumerable by strangers.
--
-- Zero rows means "not a member OR no settings row" — the caller
-- falls through to customer resolution (404 for strangers) instead
-- of misreading VTU-disabled, preserving today's error precedence
-- exactly.

CREATE OR REPLACE FUNCTION public.get_vtu_checkout_settings(
  p_merchant_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  vtu_enabled boolean,
  vtu_airtime_enabled boolean,
  vtu_data_enabled boolean,
  vtu_electricity_enabled boolean,
  vtu_tv_enabled boolean,
  vtu_betting_enabled boolean,
  vtu_merchant_commission_rate numeric,
  vtu_customer_cashback_enabled boolean,
  vtu_customer_cashback_rate numeric,
  paystack_enabled boolean,
  korapay_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  -- Membership gate: only this merchant's customers (linked or
  -- linkable) may read its checkout rates.
  v_customer_id :=
    public._vtu_checkout_caller_customer(p_merchant_id, p_user_id);
  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.vtu_enabled,
         s.vtu_airtime_enabled,
         s.vtu_data_enabled,
         s.vtu_electricity_enabled,
         s.vtu_tv_enabled,
         s.vtu_betting_enabled,
         s.vtu_merchant_commission_rate,
         s.vtu_customer_cashback_enabled,
         s.vtu_customer_cashback_rate,
         s.paystack_enabled,
         s.korapay_enabled
  FROM public.merchant_feature_settings AS s
  WHERE s.merchant_id = p_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vtu_checkout_settings(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vtu_checkout_settings(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_vtu_checkout_settings(uuid, uuid) IS
  'Phase 2 (#3694): membership-gated VTU checkout settings projection. Zero rows for non-members.';
