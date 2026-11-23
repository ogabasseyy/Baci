CREATE FUNCTION public.claim_checkout_for_paid_order_amendment(
  p_order_id uuid, p_tracking_token text, p_gateway text, p_reference text,
  p_currency text, p_expected_amount_minor bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_merchant uuid;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  -- Coordinate the cutover with configuration updates. Disabled configurations
  -- still track instruments so re-enabling cannot skip a checkout in flight.
  PERFORM 1 FROM private.paid_order_amendment_config WHERE merchant_id = v_merchant FOR SHARE;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO o FROM public.orders WHERE id = p_order_id AND merchant_id = v_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_tracking_token IS NULL OR NOT COALESCE(public.verify_order_tracking_token(p_order_id, p_tracking_token), false) THEN
    RAISE EXCEPTION 'checkout_proof_required' USING ERRCODE = '42501';
  END IF;
  IF o.payment_status NOT IN ('unpaid', 'pending')
     OR o.shipping_status NOT IN ('pending', 'processing')
     OR o.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  IF p_gateway IS DISTINCT FROM 'paystack' OR p_currency IS DISTINCT FROM 'NGN'
     OR p_expected_amount_minor IS NULL OR p_expected_amount_minor <> round(o.total * 100)::bigint
     OR p_expected_amount_minor <= 0 OR p_reference IS NULL OR p_reference !~ '^BAC-[A-Z0-9]{12}$'
     OR COALESCE(o.wallet_amount_used, 0) <> 0 THEN
    RAISE EXCEPTION 'amendment_ineligible';
  END IF;
  INSERT INTO private.paid_order_checkout_claims(
    order_id, reference, gateway, currency, expected_amount_minor, order_version
  ) VALUES (o.id, p_reference, p_gateway, p_currency, p_expected_amount_minor, md5(to_jsonb(o)::text))
  ON CONFLICT (order_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint)
TO anon, authenticated;

CREATE FUNCTION private.guard_paid_order_amendment_order_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = OLD.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF a.hold_fulfillment AND (
    NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
    OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.shipment_booking_lock_token IS DISTINCT FROM OLD.shipment_booking_lock_token
    OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
  ) THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  IF NEW.total IS DISTINCT FROM OLD.total OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.selected_quote_id IS DISTINCT FROM OLD.selected_quote_id
    OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_order_amendment_order_write
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_amendment_order_write();

CREATE FUNCTION private.guard_paid_order_amendment_pending_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.order_id IS NULL OR NEW.transaction_type <> 'payment'
     OR NEW.status NOT IN ('pending', 'processing') THEN RETURN NEW; END IF;
  -- The normal writer holds the payment advisory lock before reaching here.
  -- The order lock also covers pending inserts through other callers.
  PERFORM 1 FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_order_amendment_pending_payment
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_amendment_pending_payment();

CREATE FUNCTION private.guard_paid_order_amendment_line_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_order uuid;
  v_new_order uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_order := OLD.order_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_order := NEW.order_id; END IF;
  IF TG_OP = 'UPDATE' AND (
    to_jsonb(NEW) - 'fulfillment_data' = to_jsonb(OLD) - 'fulfillment_data'
  ) THEN
    IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id = v_old_order AND hold_fulfillment) THEN
      RAISE EXCEPTION 'amendment_hold';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM private.paid_order_amendments WHERE order_id IN (v_old_order, v_new_order)) THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER paid_order_amendment_line_write
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_amendment_line_write();

REVOKE ALL ON FUNCTION private.guard_paid_order_amendment_order_write(),
  private.guard_paid_order_amendment_pending_payment(), private.guard_paid_order_amendment_line_write()
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.transfer_paid_order_checkout_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.transaction_type = 'payment'
    AND NEW.status IN ('pending','processing','completed') THEN
    DELETE FROM private.paid_order_checkout_claims
    WHERE order_id = NEW.order_id AND reference = NEW.gateway_reference
      AND gateway = NEW.gateway AND currency = NEW.currency
      AND expected_amount_minor = round(NEW.amount * 100)::bigint;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER paid_order_checkout_claim_transfer
AFTER INSERT OR UPDATE OF status ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.transfer_paid_order_checkout_claim();
REVOKE ALL ON FUNCTION private.transfer_paid_order_checkout_claim()
FROM PUBLIC, anon, authenticated, service_role;
