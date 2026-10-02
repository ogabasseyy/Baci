-- Record provider-accepted refunds in the existing visible in-flight state.
-- Legacy pending rows remain selectable by the webhook and polling worker.
CREATE OR REPLACE FUNCTION public.record_verified_paystack_cancellation_refund_v1(
  p_refund_id uuid,
  p_provider_status text,
  p_provider_transaction_id bigint,
  p_amount_kobo bigint,
  p_currency text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund public.transactions%ROWTYPE;
  v_payment public.transactions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_status text := lower(btrim(coalesce(p_provider_status, '')));
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('pending', 'processing', 'needs-attention', 'failed', 'processed')
    OR p_provider_transaction_id IS NULL OR p_amount_kobo IS NULL
    OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'invalid_refund_evidence';
  END IF;

  SELECT * INTO v_refund FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund' AND gateway = 'paystack'
      AND gateway_reference ~ '^[0-9]+$' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  IF NOT FOUND OR v_order.merchant_id <> v_refund.merchant_id
    OR v_order.cancelled_at IS NULL OR v_order.shipping_status <> 'cancelled' THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;
  SELECT * INTO v_payment FROM public.transactions
    WHERE id = (v_refund.metadata->>'payment_transaction_id')::uuid
      AND order_id = v_order.id AND merchant_id = v_order.merchant_id
      AND transaction_type = 'payment' AND gateway = 'paystack'
      AND status = 'completed';
  IF NOT FOUND OR v_payment.gateway_reference IS NULL
    OR v_payment.amount <> v_refund.amount
    OR upper(btrim(v_refund.currency)) <> upper(btrim(p_currency))
    OR round(v_refund.amount * 100)::bigint <> p_amount_kobo
    OR (v_refund.metadata ? 'provider_payment_transaction_id' AND
        CASE WHEN coalesce(v_refund.metadata->>'provider_payment_transaction_id', '') ~ '^[0-9]+$'
                    AND length(v_refund.metadata->>'provider_payment_transaction_id') <= 20
          THEN (v_refund.metadata->>'provider_payment_transaction_id')::numeric
                 IS DISTINCT FROM p_provider_transaction_id::numeric
          ELSE true END) THEN
    RAISE EXCEPTION 'refund_evidence_mismatch';
  END IF;

  IF v_refund.status = 'completed' THEN RETURN 'already_completed'; END IF;
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN RETURN 'already_failed'; END IF;
  UPDATE public.transactions SET
    status = CASE WHEN v_status = 'processed' THEN 'completed'
                  WHEN v_status = 'failed' THEN 'failed' ELSE 'refund_pending' END,
    metadata = (coalesce(metadata, '{}'::jsonb) -
      CASE WHEN v_status IN ('processed', 'failed')
        THEN 'refund_reconciliation_hold' ELSE '' END) ||
      jsonb_build_object('provider_refund_status', v_status),
    updated_at = now()
  WHERE id = v_refund.id;

  IF v_status IN ('failed', 'needs-attention') THEN
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    RETURN v_status;
  END IF;
  IF v_status <> 'processed' THEN RETURN v_status; END IF;

  -- Every completed external payment leg needs its own completed refund.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions p
    WHERE p.order_id = v_order.id AND p.merchant_id = v_order.merchant_id
      AND p.transaction_type = 'payment' AND p.status = 'completed'
      AND p.amount > 0
      AND coalesce(p.gateway, '') NOT IN
        ('wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
          AND r.transaction_type = 'refund' AND r.gateway = p.gateway
          AND r.status = 'completed'
          AND r.metadata->>'payment_transaction_id' = p.id::text
          AND r.amount = p.amount
      )
  ) AND (
    v_order.payment_status IN ('paid', 'partially_paid', 'refunded')
    -- A wedged order (completed gateway legs the sweep never flipped to
    -- paid) stays merchant-cancellable: its funded legs were just refunded,
    -- so it must transition, reverse settlements, and notify like a paid
    -- order. Unfunded pending orders stay out.
    OR (
      v_order.payment_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM public.transactions funded
        WHERE funded.order_id = v_order.id AND funded.merchant_id = v_order.merchant_id
          AND funded.transaction_type = 'payment' AND funded.status = 'completed'
          AND funded.amount > 0
          AND coalesce(funded.gateway, '') NOT IN
            ('wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery')
      )
    )
  ) THEN
    UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
      WHERE id = v_order.id AND payment_status IN ('paid', 'partially_paid', 'pending');
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'processed_customer_email'),
           (v_order.id, v_order.merchant_id, 'processed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    UPDATE public.reconciliation_review review
      SET resolved_at = now(),
          resolution_notes = 'Paystack verified all cancelled-order gateway refunds'
      WHERE review.order_id = v_order.id
        AND review.merchant_id = v_order.merchant_id
        AND review.issue_type = 'order_cancellation_refund_requires_review'
        AND review.resolved_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.transactions r
          WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
            AND r.transaction_type = 'refund' AND r.gateway = 'paystack'
            AND r.status = 'completed'
            AND (review.metadata->>'provider_refund_id' = r.gateway_reference
                 OR review.metadata->>'refund_transaction_id' = r.id::text)
        );
  END IF;
  RETURN 'processed';
END;
$$;

CREATE OR REPLACE FUNCTION public.hold_paystack_cancellation_refund_for_review_v1(
  p_refund_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Normalize the gateway: the candidate selectors admit legacy
  -- `Paystack` / ` paystack ` rows, and an exact match here would
  -- update nothing for them — the caller then throws even after the
  -- review was filed, 503ing every sweep on the still-unheld row.
  UPDATE public.transactions
    SET metadata = coalesce(metadata, '{}'::jsonb) ||
      jsonb_build_object('refund_reconciliation_hold', left(p_reason, 120)),
      updated_at = now()
    WHERE id = p_refund_id AND transaction_type = 'refund'
      AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
      AND status IN ('refund_pending', 'pending', 'failed');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN RETURN true; END IF;
  -- A completed row needs no hold: polling ignores terminal rows and the
  -- review filed before this call is the durable record. Report success
  -- so redeliveries acknowledge instead of 503ing forever.
  RETURN EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund'
      AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
      AND status = 'completed'
  );
END;
$$;
