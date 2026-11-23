-- Checkout collection is a separate opt-in from amendment admission. A
-- creation pause must not silently redirect an enrolled checkout's funds.
ALTER TABLE private.paid_order_amendment_config
  ADD COLUMN integration_wallet_checkout boolean NOT NULL DEFAULT false;
ALTER TABLE private.paid_order_checkout_capture_bindings
  ADD COLUMN integration_wallet_checkout boolean NOT NULL DEFAULT false;

-- The customer's verified Paystack fee may increase the card charge but
-- must never increase the funded order, settlement principal or Baci fee.
CREATE FUNCTION private.paystack_amendment_checkout_fee(p_receipt jsonb,p_expected bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  charged bigint;
  fee bigint;
BEGIN
  IF p_expected IS NULL OR p_expected <= 0
    OR COALESCE(p_receipt->>'amount','') !~ '^[1-9][0-9]{0,14}$'
    OR NOT (p_receipt ? 'subaccount')
    OR (jsonb_typeof(p_receipt->'subaccount') NOT IN ('null','object'))
    OR NULLIF(btrim(p_receipt#>>'{subaccount,subaccount_code}'),'') IS NOT NULL
    OR NOT COALESCE(p_receipt->'fees_split' = 'null'::jsonb OR p_receipt#>>'{fees_split,subaccount}' = '0',false)
    OR (p_receipt->>'requested_amount' IS NOT NULL AND p_receipt->>'requested_amount' <> p_expected::text)
  THEN RETURN NULL; END IF;
  charged := (p_receipt->>'amount')::bigint;
  IF charged = p_expected THEN RETURN 0; END IF;
  IF p_receipt->>'requested_amount' IS DISTINCT FROM p_expected::text
    OR COALESCE(p_receipt->>'fees','') !~ '^[1-9][0-9]{0,14}$'
    THEN RETURN NULL; END IF;
  fee := (p_receipt->>'fees')::bigint;
  RETURN CASE WHEN charged - p_expected = fee THEN fee END;
END;
$$;
REVOKE ALL ON FUNCTION private.paystack_amendment_checkout_fee(jsonb,bigint)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_for_paid_order_amendment(
  p_order_id uuid, p_tracking_token text, p_gateway text, p_reference text,
  p_currency text, p_expected_amount_minor bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_merchant uuid;
  v_integration bigint;
  v_wallet_checkout boolean;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  -- Coordinate the cutover with configuration updates. Disabled configurations
  -- still track instruments so re-enabling cannot skip a checkout in flight.
  SELECT paystack_integration_id,integration_wallet_checkout INTO v_integration,v_wallet_checkout
  FROM private.paid_order_amendment_config WHERE merchant_id = v_merchant FOR SHARE;
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
  IF v_integration IS NULL OR p_gateway IS DISTINCT FROM 'paystack' OR p_currency IS DISTINCT FROM 'NGN'
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
  INSERT INTO private.paid_order_checkout_capture_bindings(
    reference, order_id, expected_amount_minor, currency, provider_integration_id, order_fingerprint,integration_wallet_checkout
  ) VALUES (p_reference, o.id, p_expected_amount_minor, p_currency, v_integration,
    private.paid_order_checkout_fingerprint(o),v_wallet_checkout);
  RETURN CASE WHEN v_wallet_checkout THEN 'claimed_integration' ELSE 'claimed' END;
END;
$$;
CREATE OR REPLACE FUNCTION public.resolve_paid_order_checkout_capture(
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
  v_bound_fee bigint;
  v_integration text;
  v_principal numeric;
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
  v_integration := COALESCE(p_verified->>'integration',
    CASE WHEN b.integration_wallet_checkout THEN p_verified->>'configured_integration' END);
  IF b.integration_wallet_checkout THEN
    v_bound_fee := private.paystack_amendment_checkout_fee(p_verified,b.expected_amount_minor);
  END IF;
  IF COALESCE(p_verified->>'amount','') ~ '^[1-9][0-9]{0,14}$' THEN
    v_principal := (p_verified->>'amount')::numeric - COALESCE(v_bound_fee,0);
  END IF;
  IF b.reference IS NOT NULL AND v_integration IS NULL THEN
    -- The lookup response can lack this field. Wait for a signed event
    -- that identifies the integration instead of permanently tagging it.
    RETURN jsonb_build_object('outcome', 'awaiting_evidence');
  END IF;
  IF p_verified->>'status' IS DISTINCT FROM 'success' OR p_verified->>'reference' IS DISTINCT FROM p_reference
    OR COALESCE(p_verified->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR COALESCE(p_verified->>'amount','') !~ '^[1-9][0-9]{0,14}$' THEN
    v_conflict := 'invalid_verified_capture';
  ELSIF b.reference IS NOT NULL AND (
    v_integration IS DISTINCT FROM b.provider_integration_id::text
    OR p_verified->>'currency' IS DISTINCT FROM b.currency
    OR v_principal IS DISTINCT FROM b.expected_amount_minor::numeric
    OR (b.integration_wallet_checkout AND v_bound_fee IS NULL)
    OR p_verified->>'channel' IS DISTINCT FROM 'card'
  ) THEN
    v_conflict := 'claim_evidence_mismatch';
  ELSIF t.id IS NOT NULL AND (
    t.order_id IS DISTINCT FROM o.id OR t.merchant_id IS DISTINCT FROM o.merchant_id
    OR p_verified->>'currency' IS DISTINCT FROM t.currency
    OR v_principal <> t.amount * 100
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
    RETURN jsonb_strip_nulls(jsonb_build_object('outcome', 'ready','customerFeeMinor',v_bound_fee));
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
      left(p_verified->>'id',32), left(v_integration,32),
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
  RETURN jsonb_strip_nulls(jsonb_build_object('outcome', 'ready','customerFeeMinor',v_bound_fee));
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_unallocated_paid_order_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b_wallet private.paid_order_checkout_capture_bindings%ROWTYPE;
  customer_fee bigint;
BEGIN
  IF NEW.transaction_type <> 'payment' THEN RETURN NEW; END IF;
  NEW.gateway_response := NEW.gateway_response - 'baci_paystack_checkout_customer_fee_minor';
  IF TG_OP = 'UPDATE' AND OLD.gateway_response ? 'baci_paystack_checkout_customer_fee_minor' THEN
    -- A later callback or status transition may reference this payment,
    -- but cannot erase or rewrite the certified capture's money proof.
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.gateway_reference IS DISTINCT FROM OLD.gateway_reference
      OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.gateway IS DISTINCT FROM OLD.gateway
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR (NEW.gateway_response - 'baci_paystack_checkout_customer_fee_minor')
        IS DISTINCT FROM (OLD.gateway_response - 'baci_paystack_checkout_customer_fee_minor') THEN
      RAISE EXCEPTION 'paid_order_capture_requires_reconciliation';
    END IF;
    NEW.gateway_response := OLD.gateway_response;
    RETURN NEW;
  END IF;
  IF NEW.order_id IS NULL OR NEW.gateway <> 'paystack'
    OR NEW.status NOT IN ('pending','processing','success','completed') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.order_id IS NOT DISTINCT FROM NEW.order_id
     AND OLD.gateway_reference IS NOT DISTINCT FROM NEW.gateway_reference THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
    WHERE reference = NEW.gateway_reference) THEN
    RAISE EXCEPTION 'paid_order_capture_requires_reconciliation';
  END IF;
  IF NEW.status NOT IN ('success','completed') THEN RETURN NEW; END IF;
  SELECT * INTO b_wallet FROM private.paid_order_checkout_capture_bindings
    WHERE reference = NEW.gateway_reference AND integration_wallet_checkout;
  IF FOUND THEN
    customer_fee := private.paystack_amendment_checkout_fee(NEW.gateway_response,b_wallet.expected_amount_minor);
    IF customer_fee IS NULL OR round(NEW.amount * 100) IS DISTINCT FROM b_wallet.expected_amount_minor::numeric THEN
      RAISE EXCEPTION 'paid_order_capture_requires_reconciliation';
    END IF;
    NEW.gateway_response := NEW.gateway_response - 'baci_paystack_checkout_customer_fee_minor';
    IF customer_fee > 0 THEN
      IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'paid_order_capture_requires_reconciliation'; END IF;
      NEW.gateway_response := NEW.gateway_response || jsonb_build_object('baci_paystack_checkout_customer_fee_minor',customer_fee);
    END IF;
  END IF;
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
        OR (NOT b.integration_wallet_checkout AND NEW.gateway_response->>'amount' IS DISTINCT FROM b.expected_amount_minor::text)
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
DROP TRIGGER paid_order_capture_allocation_fence ON public.transactions;
CREATE TRIGGER paid_order_capture_allocation_fence
BEFORE INSERT OR UPDATE OF status, order_id, gateway_reference, gateway_response, amount, currency, gateway
ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.guard_unallocated_paid_order_capture();
