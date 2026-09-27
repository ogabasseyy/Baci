-- Permit verified legacy completed refunds to finish the order transition and
-- notifications. Accept the supported legacy canceled shipping spelling.
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
  v_external_payments integer;
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
    OR v_order.cancelled_at IS NULL OR v_order.shipping_status NOT IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;
  SELECT * INTO v_payment FROM public.transactions
    WHERE id = (v_refund.metadata->>'payment_transaction_id')::uuid
      AND order_id = v_order.id AND merchant_id = v_order.merchant_id
      AND transaction_type = 'payment' AND gateway = 'paystack'
      AND status = 'completed';
  IF NOT FOUND AND v_refund.metadata->>'payment_transaction_id' IS NULL THEN
    -- Legacy refunds carry no payment link. Mirror the cancellation claim
    -- rule: accept the order's sole completed external payment when it
    -- shares the refund's gateway and amount.
    SELECT count(*) INTO v_external_payments FROM public.transactions
      WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
        AND transaction_type = 'payment' AND status = 'completed'
        AND amount > 0
        AND coalesce(gateway, '') NOT IN
          ('wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery');
    IF v_external_payments = 1 THEN
      SELECT * INTO v_payment FROM public.transactions
        WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
          AND transaction_type = 'payment' AND status = 'completed'
          AND amount > 0 AND gateway = v_refund.gateway
          AND amount = v_refund.amount;
    END IF;
  END IF;
  IF NOT FOUND OR v_payment.gateway_reference IS NULL
    OR v_payment.amount <> v_refund.amount
    OR upper(v_refund.currency) <> upper(p_currency)
    OR round(v_refund.amount * 100)::bigint <> p_amount_kobo
    OR (v_refund.metadata ? 'provider_payment_transaction_id' AND
        CASE WHEN coalesce(v_refund.metadata->>'provider_payment_transaction_id', '') ~ '^[0-9]+$'
                    AND length(v_refund.metadata->>'provider_payment_transaction_id') <= 20
          THEN (v_refund.metadata->>'provider_payment_transaction_id')::numeric
                 IS DISTINCT FROM p_provider_transaction_id::numeric
          ELSE true END) THEN
    RAISE EXCEPTION 'refund_evidence_mismatch';
  END IF;

  -- A locally completed row with a contradictory provider verdict falls
  -- through: persist the provider status, notify, and rotate updated_at below
  -- instead of re-selecting this row on every legacy recheck.
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN RETURN 'already_failed'; END IF;
  UPDATE public.transactions SET
    status = CASE WHEN v_status = 'processed' THEN 'completed'
                  WHEN v_status = 'failed' THEN 'failed' ELSE 'refund_pending' END,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'refund_reconciliation_hold') ||
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
      AND coalesce(p.gateway, '') NOT IN
        ('wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
          AND r.transaction_type = 'refund' AND r.gateway = p.gateway
          AND r.status = 'completed'
          AND r.amount = p.amount
          AND upper(r.currency) = upper(p.currency)
          AND (
            r.metadata->>'payment_transaction_id' = p.id::text
            OR (
              r.metadata->>'payment_transaction_id' IS NULL
              AND 1 = (
                SELECT count(*) FROM public.transactions only_payment
                 WHERE only_payment.order_id = v_order.id
                   AND only_payment.merchant_id = v_order.merchant_id
                   AND only_payment.transaction_type = 'payment'
                   AND only_payment.status = 'completed'
                   AND only_payment.amount > 0
                   AND coalesce(only_payment.gateway, '') NOT IN (
                     'wallet', 'savings', 'store_credit', 'cash', 'manual',
                     'pay_on_delivery'
                   )
              )
            )
          )
      )
  ) AND v_order.payment_status IN ('paid', 'partially_paid', 'refunded') THEN
    UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
      WHERE id = v_order.id AND payment_status IN ('paid', 'partially_paid');
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'processed_customer_email'),
           (v_order.id, v_order.merchant_id, 'processed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    -- Every payment leg is provider-verified complete, so the cancellation
    -- saga is done regardless of which metadata shape the open reviews
    -- carry (top-level IDs, accepted leg lists, or merged evidence).
    UPDATE public.reconciliation_review review
      SET resolved_at = now(),
          resolution_notes = 'Paystack verified all cancelled-order gateway refunds'
      WHERE review.order_id = v_order.id
        AND review.merchant_id = v_order.merchant_id
        AND review.issue_type = 'order_cancellation_refund_requires_review'
        AND review.resolved_at IS NULL;
  END IF;
  RETURN 'processed';
END;
$$;
