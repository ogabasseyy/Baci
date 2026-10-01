-- Treat booked wallet charges as recoverable so pre-refresh skips quote
-- replacement and recoverBookedWalletShipment can run.

CREATE OR REPLACE FUNCTION public.has_active_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  SELECT o.merchant_id
    INTO v_merchant_id
    FROM public.orders AS o
   WHERE o.id = p_order_id;

  IF v_merchant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = v_merchant_id
        AND merchant.user_id = (SELECT auth.uid())
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), v_merchant_id, 'orders', 'fulfill'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), v_merchant_id, 'orders', 'edit'
    )
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.shipping_quote_id = p_quote_id
      AND charge.status IN ('reserved', 'provider_submitting', 'booked')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_active_merchant_shipping_charge(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_merchant_shipping_charge(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.has_active_merchant_shipping_charge(uuid, uuid)
  IS 'Returns true when an authorized caller has a reserved, provider_submitting, or booked wallet shipping charge for the order quote.';
