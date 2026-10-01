-- A provider-verified Paystack refund transition and durable, once-per-order
-- notification queue. The worker alone can call the RPC after verifying the
-- refund and original transaction with Paystack.
CREATE TABLE IF NOT EXISTS public.paystack_cancellation_refund_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'processed_customer_email', 'processed_merchant_push', 'failed_merchant_push'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'sent', 'failed', 'delivery_uncertain'
  )),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  claim_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  -- Contradiction generation: a failure recorded while a worker holds
  -- this row bumps it, so the worker's finish detects the fresh
  -- evidence and requeues instead of concluding on a stale read.
  generation integer NOT NULL DEFAULT 0,
  UNIQUE (order_id, event_type)
);

CREATE INDEX IF NOT EXISTS paystack_cancellation_refund_notifications_ready_idx
  ON public.paystack_cancellation_refund_notifications (status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS paystack_cancellation_refund_notifications_merchant_idx
  ON public.paystack_cancellation_refund_notifications (merchant_id);
ALTER TABLE public.paystack_cancellation_refund_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paystack_cancellation_refund_notifications_service_role_all
  ON public.paystack_cancellation_refund_notifications;
CREATE POLICY paystack_cancellation_refund_notifications_service_role_all
  ON public.paystack_cancellation_refund_notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.paystack_cancellation_refund_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.paystack_cancellation_refund_notifications TO service_role;

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

  IF v_refund.status = 'completed' THEN RETURN 'already_completed'; END IF;
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN RETURN 'already_failed'; END IF;
  UPDATE public.transactions SET
    status = CASE WHEN v_status = 'processed' THEN 'completed'
                  WHEN v_status = 'failed' THEN 'failed' ELSE status END,
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
REVOKE ALL ON FUNCTION public.record_verified_paystack_cancellation_refund_v1(uuid,text,bigint,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_paystack_cancellation_refund_v1(uuid,text,bigint,bigint,text)
  TO service_role;

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
  UPDATE public.transactions
    SET metadata = coalesce(metadata, '{}'::jsonb) ||
      jsonb_build_object('refund_reconciliation_hold', left(p_reason, 120)),
      updated_at = now()
    WHERE id = p_refund_id AND transaction_type = 'refund'
      AND gateway = 'paystack' AND status IN ('pending', 'failed');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.hold_paystack_cancellation_refund_for_review_v1(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_paystack_cancellation_refund_for_review_v1(uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_paystack_cancellation_refund_notifications_v1(p_limit integer)
RETURNS SETOF public.paystack_cancellation_refund_notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Stale processing rows are deliberately not retried: delivery may have
  -- succeeded before the worker lost its acknowledgement.
  WITH stale AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status = 'processing' AND claimed_at < now() - interval '15 minutes'
    ORDER BY claimed_at LIMIT 50 FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'delivery_uncertain',
        last_error = 'Claim expired; delivery outcome needs review'
    FROM stale WHERE n.id = stale.id;
  -- Rows that burned all five attempts are never claimable again: move
  -- them to the observable terminal state instead of stranding them as
  -- failed forever without an operational signal.
  WITH exhausted AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status IN ('pending', 'failed') AND attempts >= 5
    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'delivery_uncertain',
        last_error = 'Notification retry limit exhausted; delivery outcome needs review'
    FROM exhausted WHERE n.id = exhausted.id;
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status IN ('pending', 'failed') AND attempts < 5
      -- Failed rows back off between attempts so a single request cannot
      -- burn all five tries during a short outage; pending rows, which
      -- have never been claimed, stay immediately eligible.
      AND (
        claimed_at IS NULL
        OR claimed_at < now() - make_interval(mins => greatest(least(attempts, 4), 1) * 2)
      )
    ORDER BY created_at LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
    FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'processing', attempts = n.attempts + 1,
        claimed_at = now(), claim_token = extensions.gen_random_uuid()
    FROM candidates WHERE n.id = candidates.id RETURNING n.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_paystack_cancellation_refund_notifications_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_cancellation_refund_notifications_v1(integer)
  TO service_role;
