CREATE TABLE private.accepted_partner_orders (
  submission_id uuid PRIMARY KEY REFERENCES private.partner_order_settlements (submission_id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders (id),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.accepted_partner_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.accepted_partner_orders FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.partner_order_review_holds (
  submission_id uuid PRIMARY KEY REFERENCES private.partner_payment_captures (submission_id),
  reason text NOT NULL CHECK (reason IN ('SETTLEMENT_REVIEW_REQUIRED', 'ORDER_REVIEW_REQUIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.partner_order_review_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.partner_order_review_holds FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.accept_settled_partner_order(
  p_submission_id uuid,
  p_merchant_id uuid,
  p_connection_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_submission private.partner_order_submissions%ROWTYPE;
  v_quote jsonb;
  v_settlement private.partner_order_settlements%ROWTYPE;
  v_capture private.partner_payment_captures%ROWTYPE;
  v_recipient jsonb;
  v_address jsonb;
  v_lines jsonb;
  v_order_id uuid;
  v_delivery numeric;
  v_payable numeric;
  v_buyer_total numeric;
  v_tax_minor numeric;
  v_live_tax_minor numeric;
  v_vat_registered boolean;
BEGIN
  SELECT s.* INTO v_submission
  FROM private.partner_order_submissions AS s
  WHERE s.id = p_submission_id AND s.merchant_id = p_merchant_id
    AND s.connection_id = p_connection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_submission_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.accepted_partner_orders AS a WHERE a.submission_id = p_submission_id
  ) THEN
    RETURN private.partner_order_receipt(v_submission);
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.partner_order_review_holds AS h WHERE h.submission_id = p_submission_id
  ) THEN
    RAISE EXCEPTION 'partner_order_requires_review' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_settlement
  FROM private.partner_order_settlements AS e WHERE e.submission_id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_settlement_not_verified' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO STRICT v_capture
  FROM private.partner_payment_captures AS c WHERE c.submission_id = p_submission_id;

  SELECT q.snapshot INTO STRICT v_quote
  FROM private.partner_delivery_quotes AS q
  WHERE q.id = v_submission.quote_id AND q.merchant_id = p_merchant_id
    AND q.connection_id = p_connection_id;

  IF v_quote->>'currency' IS DISTINCT FROM 'NGN'
     OR v_quote->>'settlement_basis' IS DISTINCT FROM 'base_plus_delivery'
     OR jsonb_typeof(v_quote->'merchant_payable_minor') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_quote->'delivery_minor') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_quote->'tax_minor') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_quote->'total_minor') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_quote->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'partner_quote_economics_invalid' USING ERRCODE = '22023';
  END IF;

  v_delivery := (v_quote->>'delivery_minor')::numeric;
  v_tax_minor := (v_quote->>'tax_minor')::numeric;
  v_payable := (v_quote->>'merchant_payable_minor')::numeric;
  v_buyer_total := (v_quote->>'total_minor')::numeric;
  -- An FX/fee conversion requires a verified allocation policy. Only a
  -- capture that exactly matches this NGN quote is admissible here.
  IF v_capture.currency IS DISTINCT FROM 'NGN'
     OR v_capture.amount_minor IS DISTINCT FROM v_buyer_total
     OR v_settlement.currency IS DISTINCT FROM 'NGN'
     OR v_settlement.amount_minor IS DISTINCT FROM v_payable
     OR v_delivery < 0 OR v_delivery <> trunc(v_delivery)
     OR v_tax_minor < 0 OR v_tax_minor <> trunc(v_tax_minor)
     OR v_payable <= v_delivery + v_tax_minor THEN
    RAISE EXCEPTION 'partner_quote_economics_mismatch' USING ERRCODE = '22023';
  END IF;

  v_recipient := v_submission.submission->'recipient';
  v_address := v_quote #> '{carrier_quote,quote_request,receiver}';
  IF nullif(btrim(v_recipient->>'email'), '') IS NULL
     OR nullif(btrim(v_recipient->>'name'), '') IS NULL
     OR nullif(btrim(v_recipient->>'phone'), '') IS NULL
     OR v_address->>'countryCode' IS DISTINCT FROM 'NG'
     OR nullif(btrim(v_address->>'address'), '') IS NULL
     OR nullif(btrim(v_address->>'city'), '') IS NULL
     OR nullif(btrim(v_address->>'state'), '') IS NULL THEN
    RAISE EXCEPTION 'partner_recipient_incomplete' USING ERRCODE = '22023';
  END IF;

  v_address := v_address || jsonb_build_object(
    'name', v_recipient->>'name', 'phone', v_recipient->>'phone', 'email', v_recipient->>'email'
  );

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', item.product_id,
    'variant_id', item.variant_id,
    'offer_id', item.offer_id,
    'condition', item.condition,
    'quantity', item.quantity,
    'price', item.base_unit_price_minor / 100
  )) INTO v_lines
  FROM jsonb_to_recordset(v_quote->'items') AS item(
    product_id uuid, variant_id uuid, offer_id uuid, condition text,
    quantity integer, base_unit_price_minor numeric
  );

  SELECT COALESCE(m.vat_registration_status = 'registered', false)
  INTO STRICT v_vat_registered FROM public.merchants AS m
  WHERE m.id = p_merchant_id
  FOR SHARE;

  -- Use Baci's inventory-aware writer and leave the carrier quote unbound.
  -- The existing storefront quote funding path would incorrectly treat the
  -- third-party delivery payment as platform-held shipping funds.
  SELECT created.id INTO STRICT v_order_id
  FROM private.create_storefront_order(
    p_merchant_id => p_merchant_id,
    p_customer_email => v_recipient->>'email',
    p_customer_name => v_recipient->>'name',
    p_items => v_lines,
    p_customer_phone => v_recipient->>'phone',
    p_shipping_fee => v_delivery / 100,
    p_tax_amount => v_tax_minor / 100,
    p_payment_method => 'external',
    p_payment_status => 'pending',
    p_shipping_address => v_address,
    p_source => 'partner',
    p_expected_total => v_payable / 100
  ) AS created;

  -- Recheck Baci's exact tax formula after the writer locks the product rows.
  -- The storefront writer itself accepts up to one naira of tax drift.
  SELECT CASE WHEN v_vat_registered THEN COALESCE(SUM(
    CASE WHEN COALESCE(p.vat_category_code, 'S') = 'S'
      THEN round(round(oi.quantity * oi.price, 2) * COALESCE(p.vat_rate, 7.5) / 100, 2)
      ELSE 0 END
  ), 0) * 100 ELSE 0 END INTO v_live_tax_minor
  FROM public.order_items AS oi
  JOIN public.products AS p ON p.id = oi.product_id AND p.merchant_id = p_merchant_id
  WHERE oi.order_id = v_order_id;
  IF v_live_tax_minor IS DISTINCT FROM v_tax_minor THEN
    RAISE EXCEPTION 'partner_order_tax_changed' USING ERRCODE = '22023';
  END IF;

  -- The storefront writer tolerates small total drift. Partner settlement
  -- requires the exact subtotal, delivery, and sellable item price snapshots.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE o.id = v_order_id AND o.merchant_id = p_merchant_id
      AND o.currency = 'NGN' AND o.source = 'partner'
      AND o.total = v_payable / 100 AND o.shipping_fee = v_delivery / 100
      AND o.tax_amount = v_tax_minor / 100
      AND o.subtotal = (v_payable - v_delivery - v_tax_minor) / 100
      AND o.selected_quote_id IS NULL AND o.shipping_funding_source IS NULL
  ) OR EXISTS (
    SELECT item.product_id, item.variant_id, item.offer_id, item.quantity, item.price
    FROM jsonb_to_recordset(v_lines) AS item(
      product_id uuid, variant_id uuid, offer_id uuid, quantity integer, price numeric
    )
    EXCEPT ALL
    SELECT oi.product_id, oi.variant_id, oi.product_offer_id, oi.quantity, oi.price
    FROM public.order_items AS oi WHERE oi.order_id = v_order_id
  ) OR (
    SELECT count(*) FROM public.order_items AS oi WHERE oi.order_id = v_order_id
  ) <> jsonb_array_length(v_lines) THEN
    RAISE EXCEPTION 'partner_order_price_or_items_changed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency, status,
    gateway, gateway_reference, description, metadata
  ) VALUES (
    p_merchant_id, v_order_id, 'payment', v_payable / 100, 'NGN', 'completed',
    'partner_settlement', p_submission_id::text, 'Verified partner settlement',
    jsonb_build_object('partner_submission_id', p_submission_id)
  );

  UPDATE public.orders
  SET amount_paid = v_payable / 100, payment_status = 'paid', updated_at = now()
  WHERE id = v_order_id AND merchant_id = p_merchant_id;

  INSERT INTO private.accepted_partner_orders (submission_id, order_id)
  VALUES (p_submission_id, v_order_id);

  RETURN private.partner_order_receipt(v_submission);
END;
$$;

REVOKE ALL ON FUNCTION private.accept_settled_partner_order(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.partner_order_receipt(s private.partner_order_submissions)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'submission_id', s.id,
    'partner_order_id', s.partner_order_id,
    'received_at', s.received_at,
    'status', CASE
      WHEN a.order_id IS NOT NULL THEN 'accepted'
      WHEN h.reason IS NOT NULL THEN 'review_required'
      WHEN EXISTS (
        SELECT 1 FROM private.partner_order_settlements AS e
        WHERE e.submission_id = s.id
      ) THEN 'settlement_verified'
      WHEN EXISTS (
        SELECT 1 FROM private.partner_payment_captures AS c
        WHERE c.submission_id = s.id
      ) THEN 'payment_verified'
      ELSE 'pending_verification'
    END
  ) || CASE WHEN a.order_id IS NOT NULL
    THEN jsonb_build_object('order_id', a.order_id)
    WHEN h.reason IS NOT NULL THEN jsonb_build_object('review_reason', h.reason)
    ELSE '{}'::jsonb END
  FROM (SELECT s.id AS submission_id) AS submission
  LEFT JOIN private.accepted_partner_orders AS a USING (submission_id)
  LEFT JOIN private.partner_order_review_holds AS h USING (submission_id);
$$;

CREATE FUNCTION public.read_partner_order_tracking(
  p_merchant_id uuid,
  p_order_id uuid,
  p_connection_id text,
  p_route_proof jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response jsonb;
BEGIN
  IF p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR pg_column_size(p_route_proof) > 4096
     OR private.verify_shipping_quote_route_proof(
       p_route_proof, 'read_partner_order_tracking', p_order_id, p_merchant_id
     ) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object(
       'connection_id', p_connection_id
     ) THEN
    RAISE EXCEPTION 'invalid_partner_tracking_proof' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'order_id', o.id,
    'partner_order_id', s.partner_order_id,
    'payment_status', COALESCE(o.payment_status, 'pending'),
    'shipping_status', COALESCE(o.shipping_status, 'pending'),
    'tracking', CASE WHEN nullif(btrim(o.shipping_provider), '') IS NOT NULL
        AND nullif(btrim(o.tracking_number), '') IS NOT NULL
      THEN jsonb_build_object('provider', o.shipping_provider, 'tracking_number', o.tracking_number)
      ELSE NULL END
  ) INTO v_response
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN public.orders AS o ON o.id = a.order_id AND o.merchant_id = s.merchant_id
  WHERE a.order_id = p_order_id AND s.merchant_id = p_merchant_id
    AND s.connection_id = p_connection_id;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.read_partner_order_tracking(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_partner_order_tracking(uuid, uuid, text, jsonb)
  TO anon, authenticated;
