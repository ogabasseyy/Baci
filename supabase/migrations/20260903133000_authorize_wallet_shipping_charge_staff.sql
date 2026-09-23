-- Wallet booking uses orders:fulfill and order PATCH's orders:edit gate;
-- the previous definitions admitted only the merchant owner.
DROP POLICY IF EXISTS merchant_shipping_charges_owner_read
  ON public.merchant_shipping_charges;
CREATE POLICY merchant_shipping_charges_owner_read
  ON public.merchant_shipping_charges
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'fulfill'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'orders', 'edit'
    )
  );
CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid,
  p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
  v_charge_id uuid;
  v_charge_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND
     OR NOT (
       public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
       )
       OR public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
       )
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'
     OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM public.merchant_shipping_charges
  WHERE order_id = p_order_id AND shipping_quote_id = p_quote_id
  FOR UPDATE;
  SELECT * INTO v_quote
  FROM public.shipping_quotes
  WHERE id = p_quote_id AND merchant_id = v_order.merchant_id
    AND provider = 'GIGL' AND currency = 'NGN'
  FOR SHARE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR SHARE;
  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL
     OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id
     OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_quote.is_station_pickup
     -- A reservation is an attested debit. It remains retryable after its
     -- quote expires; only a new debit must use a live quote.
     OR (v_existing.id IS NULL AND v_quote.expires_at <= now())
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN
    RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE = '22023';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
      SET attempt_token_digest = pg_catalog.encode(
            extensions.digest(p_attempt_token, 'sha256'), 'hex'
          ), updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    SELECT available_balance INTO balance_after
    FROM public.merchant_wallets
    WHERE merchant_id = v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount,
      balance_after, v_existing.status;
    RETURN;
  END IF;
  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < v_quote.price THEN
    RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance - v_quote.price, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type,
    source_id, description, status
  ) VALUES (
    v_wallet.id, v_order.merchant_id, 'debit', v_quote.price, balance_after,
    'gigl_shipping', p_order_id, 'GIGL shipping reservation', 'completed'
  ) RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges AS charge(
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, debit_transaction_id
  ) VALUES (
    v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
    v_quote.provider_cost, v_quote.platform_margin,
    pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), v_tx
  ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;
  RETURN QUERY SELECT v_charge_id, v_quote.price, balance_after, v_charge_status;
END;
$$;
CREATE OR REPLACE FUNCTION public.begin_merchant_shipping_charge_submission(
  p_charge_id uuid, p_attempt_token text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_status text;
  v_digest text := pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex');
BEGIN
  SELECT c.status INTO v_status
  FROM public.merchant_shipping_charges AS c
  WHERE c.id = p_charge_id
    AND (
      public.check_staff_permission((SELECT auth.uid()), c.merchant_id, 'orders', 'fulfill')
      OR public.check_staff_permission((SELECT auth.uid()), c.merchant_id, 'orders', 'edit')
    )
    AND c.attempt_token_digest = v_digest
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_status = 'reserved' THEN
    UPDATE public.merchant_shipping_charges
    SET status = 'provider_submitting', provider_submitting_at = now(), updated_at = now()
    WHERE id = p_charge_id
    RETURNING status INTO v_status;
  END IF;
  RETURN v_status;
END;
$$;
CREATE OR REPLACE FUNCTION public.complete_merchant_shipping_charge(
  p_charge_id uuid, p_attempt_token text, p_shipment_id uuid
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_status text;
  v_digest text := pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex');
BEGIN
  SELECT msc.* INTO v_charge
  FROM public.merchant_shipping_charges AS msc
  WHERE msc.id = p_charge_id
    AND (
      public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'fulfill')
      OR public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'edit')
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
    SET status = 'booked', shipment_id = v_shipment.id,
        completed_at = now(), updated_at = now()
    WHERE id = v_charge.id
    RETURNING status INTO v_status;
    v_charge.status := v_status;
  END IF;
  RETURN v_charge.status;
END;
$$;
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
CREATE OR REPLACE FUNCTION public.mark_merchant_shipping_charge_for_reconciliation(
  p_charge_id uuid, p_attempt_token text, p_reason_code text,
  p_provider_reference text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_status text;
  v_digest text := pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex');
BEGIN
  SELECT c.status INTO v_status
  FROM public.merchant_shipping_charges AS c
  WHERE c.id = p_charge_id
    AND (
      public.check_staff_permission((SELECT auth.uid()), c.merchant_id, 'orders', 'fulfill')
      OR public.check_staff_permission((SELECT auth.uid()), c.merchant_id, 'orders', 'edit')
    )
    AND c.attempt_token_digest = v_digest
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_status IN ('reserved', 'provider_submitting') THEN
    UPDATE public.merchant_shipping_charges
    SET status = 'needs_reconciliation', failure_code = p_reason_code,
        provider_reference = p_provider_reference, updated_at = now()
    WHERE id = p_charge_id
    RETURNING status INTO v_status;
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text),
  public.begin_merchant_shipping_charge_submission(uuid, text),
  public.complete_merchant_shipping_charge(uuid, text, uuid),
  public.refund_merchant_shipping_charge(uuid, text, text),
  public.mark_merchant_shipping_charge_for_reconciliation(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text),
  public.begin_merchant_shipping_charge_submission(uuid, text),
  public.complete_merchant_shipping_charge(uuid, text, uuid),
  public.refund_merchant_shipping_charge(uuid, text, text),
  public.mark_merchant_shipping_charge_for_reconciliation(uuid, text, text, text)
  TO authenticated;
