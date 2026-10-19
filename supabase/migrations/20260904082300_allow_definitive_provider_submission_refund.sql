-- Definitive booking failures without a provider shipment must refund immediately,
-- even while provider_submitting is still inside the grace window.

CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge(
  p_charge_id uuid, p_attempt_token text, p_reason_code text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  SELECT msc.* INTO v_charge
  FROM public.merchant_shipping_charges AS msc
  WHERE msc.id = p_charge_id
    AND (
      public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'fulfill')
      OR public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'edit')
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_charge.attempt_token_digest <> pg_catalog.encode(
    extensions.digest(p_attempt_token, 'sha256'), 'hex'
  ) THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_charge.status = 'refunded' THEN RETURN v_charge.status; END IF;
  IF v_charge.status IN ('booked', 'needs_reconciliation') THEN RETURN v_charge.status; END IF;
  IF v_charge.status = 'provider_submitting'
     AND v_charge.provider_submitting_at IS NOT NULL
     AND v_charge.provider_submitting_at > now() - interval '15 minutes'
     AND v_charge.shipment_id IS NOT NULL THEN
    RETURN v_charge.status;
  END IF;
  IF v_charge.status NOT IN ('reserved', 'provider_submitting') THEN RETURN v_charge.status; END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance + v_charge.charged_amount, updated_at = now()
  WHERE merchant_id = v_charge.merchant_id
  RETURNING available_balance INTO v_balance;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type,
    source_id, description, status
  )
  SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
    v_balance, 'gigl_shipping', v_charge.order_id,
    'GIGL shipping reservation refund', 'completed'
  FROM public.merchant_wallets
  WHERE merchant_id = v_charge.merchant_id
  RETURNING id INTO v_transaction;
  UPDATE public.merchant_shipping_charges
  SET status = 'refunded', refund_transaction_id = v_transaction,
      failure_code = p_reason_code, refunded_at = now(), updated_at = now()
  WHERE id = v_charge.id;
  RETURN 'refunded';
END;
$$;

REVOKE ALL ON FUNCTION public.refund_merchant_shipping_charge(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_merchant_shipping_charge(uuid, text, text)
  TO authenticated;
