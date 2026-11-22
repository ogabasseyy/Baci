ALTER TABLE private.paid_order_amendment_config
  ADD COLUMN paystack_integration_id bigint CHECK (paystack_integration_id > 0);

-- Keep an immutable copy after the pending transaction takes over the checkout fence.
-- A webhook can arrive on either side of that handoff.
CREATE TABLE private.paid_order_checkout_capture_bindings (
  reference text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  provider_integration_id bigint NOT NULL CHECK (provider_integration_id > 0),
  order_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paid_order_checkout_capture_bindings_order_idx
  ON private.paid_order_checkout_capture_bindings(order_id);

CREATE TABLE private.paid_order_checkout_capture_exceptions (
  reference text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  outcome text NOT NULL CHECK (outcome IN ('review', 'unapplied')),
  reason text NOT NULL,
  provider_transaction_id text,
  provider_integration_id text,
  amount_minor text,
  currency text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paid_order_checkout_capture_exceptions_order_idx
  ON private.paid_order_checkout_capture_exceptions(order_id);

ALTER TABLE private.paid_order_checkout_capture_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_checkout_capture_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_checkout_capture_bindings,
  private.paid_order_checkout_capture_exceptions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.paid_order_checkout_fingerprint(o public.orders)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT md5(jsonb_build_array(
    o.total, o.currency, o.payment_method, o.source, o.shipping_address,
    o.selected_quote_id, o.wallet_amount_used, o.shipping_fee, o.tax_amount, o.discount_amount,
    private.gigl_order_remaining_retained_shipping(o.id, o.merchant_id),
    (SELECT jsonb_agg(to_jsonb(i) - 'fulfillment_data' ORDER BY i.id)
      FROM public.order_items i WHERE i.order_id = o.id)
  )::text);
$$;
REVOKE ALL ON FUNCTION private.paid_order_checkout_fingerprint(public.orders)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_for_paid_order_amendment(
  p_order_id uuid, p_tracking_token text, p_gateway text, p_reference text,
  p_currency text, p_expected_amount_minor bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  v_merchant uuid;
  v_integration bigint;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  -- Coordinate the cutover with configuration updates. Disabled configurations
  -- still track instruments so re-enabling cannot skip a checkout in flight.
  SELECT paystack_integration_id INTO v_integration
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
    reference, order_id, expected_amount_minor, currency, provider_integration_id, order_fingerprint
  ) VALUES (p_reference, o.id, p_expected_amount_minor, p_currency, v_integration,
    private.paid_order_checkout_fingerprint(o));
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_for_paid_order_amendment(uuid,text,text,text,text,bigint)
TO anon, authenticated;
