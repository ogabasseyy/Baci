CREATE FUNCTION public.resolve_paid_order_checkout_capture(
  p_reference text, p_verified jsonb, p_platform_fee_minor bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b private.paid_order_checkout_capture_bindings%ROWTYPE;
  t public.transactions%ROWTYPE;
  o public.orders%ROWTYPE;
  v_order_id uuid;
  v_conflict text;
  v_outcome text;
  v_retained_shipping_minor bigint;
  v_original_capture text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'verified_capture_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM private.paid_order_checkout_capture_bindings WHERE reference = p_reference;
  SELECT * INTO t FROM public.transactions WHERE gateway_reference = p_reference
    AND gateway = 'paystack' AND transaction_type = 'payment';
  v_order_id := COALESCE(b.order_id, t.order_id);
  IF v_order_id IS NULL OR (b.reference IS NULL AND NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendments WHERE order_id = v_order_id
  )) THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || v_order_id::text, 0));
  -- Match the existing completion lock order for an already-registered payment.
  SELECT * INTO t FROM public.transactions WHERE gateway_reference = p_reference
    AND gateway = 'paystack' AND transaction_type = 'payment' FOR UPDATE;
  SELECT * INTO o FROM public.orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT e.details->>'captureId' INTO v_original_capture
  FROM private.paid_order_amendments a JOIN private.paid_order_amendment_events e
    ON e.amendment_id = a.id AND e.event_type = 'confirmed'
  WHERE a.order_id = o.id;
  IF b.reference IS NULL AND v_original_capture IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT outcome INTO v_outcome FROM private.paid_order_checkout_capture_exceptions WHERE reference = p_reference;
  IF FOUND THEN RETURN jsonb_build_object('outcome', v_outcome); END IF;
  IF b.reference IS NOT NULL AND p_verified->>'integration' IS NULL THEN
    -- The lookup response can lack this field. Wait for a signed event
    -- that identifies the integration instead of permanently tagging it.
    RETURN jsonb_build_object('outcome', 'awaiting_evidence');
  END IF;
  IF p_verified->>'status' IS DISTINCT FROM 'success' OR p_verified->>'reference' IS DISTINCT FROM p_reference
    OR COALESCE(p_verified->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR COALESCE(p_verified->>'amount','') !~ '^[1-9][0-9]{0,14}$' THEN
    v_conflict := 'invalid_verified_capture';
  ELSIF b.reference IS NOT NULL AND (
    p_verified->>'integration' IS DISTINCT FROM b.provider_integration_id::text
    OR p_verified->>'currency' IS DISTINCT FROM b.currency
    OR p_verified->>'amount' IS DISTINCT FROM b.expected_amount_minor::text
    OR p_verified->>'channel' IS DISTINCT FROM 'card'
  ) THEN
    v_conflict := 'claim_evidence_mismatch';
  ELSIF t.id IS NOT NULL AND (
    t.order_id IS DISTINCT FROM o.id OR t.merchant_id IS DISTINCT FROM o.merchant_id
    OR p_verified->>'currency' IS DISTINCT FROM t.currency
    OR (p_verified->>'amount')::numeric <> t.amount * 100
  ) THEN
    v_conflict := 'transaction_evidence_mismatch';
  END IF;

  -- The original capture can be replayed without reclassifying it as
  -- unapplied after its order gets amended.
  IF v_conflict IS NULL AND v_original_capture = t.id::text THEN
    RETURN jsonb_build_object('outcome','original_replay');
  END IF;

  IF v_conflict IS NULL AND t.id IS NOT NULL AND t.status = 'completed'
    AND t.gateway_response->>'id' = p_verified->>'id'
    AND v_original_capture IS NULL THEN
    RETURN jsonb_build_object('outcome', 'ready');
  END IF;

  IF v_conflict IS NOT NULL OR v_original_capture IS NOT NULL
     OR b.order_fingerprint IS DISTINCT FROM private.paid_order_checkout_fingerprint(o)
     OR o.payment_status NOT IN ('unpaid','pending') OR COALESCE(o.amount_paid,0) <> 0
     OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
     OR EXISTS (SELECT 1 FROM public.transactions x WHERE x.order_id = o.id
       AND x.transaction_type = 'payment' AND x.status IN ('success','completed','refund_pending','refunded')
       AND x.id IS DISTINCT FROM t.id) THEN
    v_outcome := CASE WHEN v_conflict IS NULL THEN 'unapplied' ELSE 'review' END;
    INSERT INTO private.paid_order_checkout_capture_exceptions(
      reference, order_id, outcome, reason, provider_transaction_id, provider_integration_id, amount_minor, currency
    ) VALUES (p_reference, o.id, v_outcome, COALESCE(v_conflict,'order_no_longer_payable'),
      left(p_verified->>'id',32), left(p_verified->>'integration',32),
      left(p_verified->>'amount',32), left(p_verified->>'currency',12));
    RETURN jsonb_build_object('outcome',v_outcome);
  END IF;

  IF t.id IS NULL THEN
    IF p_platform_fee_minor IS NULL OR p_platform_fee_minor < 0
      OR p_platform_fee_minor > b.expected_amount_minor THEN
      RAISE EXCEPTION 'invalid_capture_platform_fee' USING ERRCODE = '22023';
    END IF;
    v_retained_shipping_minor := least(
      round(private.gigl_order_remaining_retained_shipping(o.id, o.merchant_id) * 100)::bigint,
      b.expected_amount_minor - p_platform_fee_minor
    );
    INSERT INTO public.transactions(
      merchant_id, order_id, transaction_type, amount, currency, status, gateway,
      gateway_reference, platform_fee, merchant_amount, metadata
    ) VALUES (
      o.merchant_id,o.id,'payment',b.expected_amount_minor::numeric / 100,b.currency,'pending','paystack',
      p_reference,p_platform_fee_minor::numeric / 100,
      (b.expected_amount_minor - p_platform_fee_minor - v_retained_shipping_minor)::numeric / 100,
      jsonb_build_object('order_checkout_capture_binding',true)
    );
  END IF;
  RETURN jsonb_build_object('outcome', 'ready');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_paid_order_checkout_capture(text,jsonb,bigint)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_paid_order_checkout_capture(text,jsonb,bigint) TO service_role;

CREATE FUNCTION private.guard_unallocated_paid_order_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.order_id IS NULL OR NEW.transaction_type <> 'payment' OR NEW.gateway <> 'paystack'
    OR NEW.status NOT IN ('pending','processing','success','completed') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id
     AND OLD.gateway_reference IS NOT DISTINCT FROM NEW.gateway_reference THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
    WHERE reference = NEW.gateway_reference) THEN
    RAISE EXCEPTION 'paid_order_capture_requires_reconciliation';
  END IF;
  IF NEW.status NOT IN ('success','completed') THEN RETURN NEW; END IF;
  IF EXISTS (
      SELECT 1 FROM private.paid_order_checkout_capture_bindings b
      JOIN public.orders o ON o.id = b.order_id
      WHERE b.reference = NEW.gateway_reference AND (
        NEW.order_id IS DISTINCT FROM b.order_id
        OR o.payment_status NOT IN ('unpaid','pending') OR COALESCE(o.amount_paid,0) <> 0
        OR o.cancelled_at IS NOT NULL OR o.shipping_status NOT IN ('pending','processing')
        OR b.order_fingerprint IS DISTINCT FROM private.paid_order_checkout_fingerprint(o)
        OR NEW.gateway_response->>'reference' IS DISTINCT FROM b.reference
        OR NEW.gateway_response->>'currency' IS DISTINCT FROM b.currency
        OR NEW.gateway_response->>'amount' IS DISTINCT FROM b.expected_amount_minor::text
        OR (NEW.gateway_response->>'integration' IS NOT NULL
          AND NEW.gateway_response->>'integration' IS DISTINCT FROM b.provider_integration_id::text)
      )
    )
    OR EXISTS (
      SELECT 1 FROM private.paid_order_amendments a
      JOIN private.paid_order_amendment_events e ON e.amendment_id = a.id AND e.event_type = 'confirmed'
      WHERE a.order_id = NEW.order_id AND e.details->>'captureId' IS DISTINCT FROM NEW.id::text
    ) THEN
    RAISE EXCEPTION 'paid_order_capture_requires_reconciliation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_unallocated_paid_order_capture()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_capture_allocation_fence
BEFORE INSERT OR UPDATE OF status, order_id, gateway_reference ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_unallocated_paid_order_capture();

CREATE FUNCTION private.guard_amendment_unresolved_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions WHERE order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'amendment_payment_open';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_amendment_unresolved_capture()
FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_amendment_unresolved_capture_fence
BEFORE INSERT ON private.paid_order_amendments
FOR EACH ROW EXECUTE FUNCTION private.guard_amendment_unresolved_capture();

-- The funded amount belongs to the original allocation, even after the hold ends.
CREATE OR REPLACE FUNCTION private.guard_paid_order_amendment_order_write()
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
  IF NEW.total IS DISTINCT FROM OLD.total OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.selected_quote_id IS DISTINCT FROM OLD.selected_quote_id
    OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address THEN
    RAISE EXCEPTION 'amendment_hold';
  END IF;
  RETURN NEW;
END;
$$;
