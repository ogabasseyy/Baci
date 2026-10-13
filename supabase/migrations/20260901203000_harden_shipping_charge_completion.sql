-- A wallet charge may only be completed by the shipment created for the same
-- merchant and order. This prevents a caller from binding an unrelated
-- shipment ID to a reserved charge.
CREATE OR REPLACE FUNCTION public.complete_merchant_shipping_charge(
  p_charge_id uuid,
  p_attempt_token text,
  p_shipment_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_status text;
  v_digest text := pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex');
BEGIN
  SELECT msc.* INTO v_charge
  FROM public.merchant_shipping_charges AS msc
  WHERE msc.id = p_charge_id
    AND EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = msc.merchant_id
        AND m.user_id = auth.uid()
    )
    AND msc.attempt_token_digest = v_digest
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;

  IF v_charge.status = 'provider_submitting' THEN
    SELECT s.* INTO v_shipment
    FROM public.shipments AS s
    WHERE s.id = p_shipment_id
      AND s.merchant_id = v_charge.merchant_id
      AND s.order_id = v_charge.order_id
      AND s.shipping_quote_id = v_charge.shipping_quote_id
      AND s.provider = 'GIGL'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'shipment_binding_mismatch' USING ERRCODE = '22023';
    END IF;
    UPDATE public.merchant_shipping_charges
    SET status = 'booked',
        shipment_id = v_shipment.id,
        completed_at = now(),
        updated_at = now()
    WHERE id = v_charge.id
    RETURNING status INTO v_status;
    v_charge.status := v_status;
  END IF;
  RETURN v_charge.status;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_shipping_charge(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_merchant_shipping_charge(uuid, text, uuid) TO authenticated;

-- Funding requests are user-created only while pending. Provider assignment
-- remains service-role-only, and authenticated callers cannot mutate or delete
-- a request after insertion.
DROP POLICY IF EXISTS merchant_wallet_request_owner_insert ON public.merchant_wallet_funding_account_requests;
CREATE POLICY merchant_wallet_request_owner_insert
  ON public.merchant_wallet_funding_account_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = merchant_wallet_funding_account_requests.merchant_id
        AND m.user_id = auth.uid()
    )
  );
REVOKE ALL ON TABLE public.merchant_wallet_funding_account_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.merchant_wallet_funding_account_requests TO authenticated;
