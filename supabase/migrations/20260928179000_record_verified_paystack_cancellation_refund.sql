-- Provider-verdict transition for legacy Paystack cancellation refunds.
-- Split out of 20260927150500_complete_legacy_paystack_cancellation_refunds.sql,
-- which keeps only the shared aggregate finalizer: the combined file
-- exceeded the 300-line maximum. Depends on
-- finalize_refunded_cancellation_order_v1 (defined earlier in the
-- sequence) for the covered-path aggregate transition. Behavior
-- unchanged from the combined version.

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
    WHERE id = p_refund_id AND transaction_type = 'refund' AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
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
      AND transaction_type = 'payment' AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
      AND status = 'completed';
  IF NOT FOUND AND v_refund.metadata->>'payment_transaction_id' IS NULL THEN
    -- Legacy refunds carry no payment link. Mirror the cancellation claim
    -- rule: accept the order's sole completed external payment when it
    -- shares the refund's gateway and covers its amount. Partial refunds
    -- verify against their own row amount; the completion gate below sums
    -- them per leg.
    SELECT count(*) INTO v_external_payments FROM public.transactions
      WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
        AND transaction_type = 'payment' AND status = 'completed'
        AND amount > 0
        AND COALESCE(public.normalized_gateway_name_v1(gateway), '') NOT IN
          ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY');
    IF v_external_payments = 1 THEN
      -- Normalize gateways like the aggregate coverage gate: a legacy
      -- `Paystack` leg and its `paystack` refund must verify together.
      SELECT * INTO v_payment FROM public.transactions
        WHERE order_id = v_order.id AND merchant_id = v_order.merchant_id
          AND transaction_type = 'payment' AND status = 'completed'
          AND amount > 0
          AND public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(v_refund.gateway)
          AND amount >= v_refund.amount;
    END IF;
  END IF;
  IF NOT FOUND OR v_payment.gateway_reference IS NULL
    OR v_refund.amount > v_payment.amount
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

  -- A locally completed row with a contradictory provider verdict falls
  -- through: persist the provider status, notify, and rotate updated_at below.
  -- Nonterminal verdicts (pending/processing/needs-attention) keep a
  -- completed row completed so the legacy recheck keeps verifying it:
  -- demoting to refund_pending would strand legacy rows that lack the
  -- cancellation description the pending worker requires, leaving them
  -- selected by neither worker.
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN RETURN 'already_failed'; END IF;
  -- Repeat verdicts are not new evidence: only a status transition (or
  -- a first failure) reaches the alert insert. Still rotate the row so
  -- reviewed rows cannot pin the workers' oldest-25 batch.
  IF v_status IN ('failed', 'needs-attention')
    AND v_refund.metadata->>'provider_refund_status' = v_status THEN
    UPDATE public.transactions SET updated_at = now() WHERE id = v_refund.id;
    RETURN v_status;
  END IF;
  UPDATE public.transactions SET
    status = CASE WHEN v_status = 'processed' THEN 'completed'
                  WHEN v_status = 'failed' THEN 'failed'
                  WHEN v_refund.status = 'completed' THEN 'completed'
                  ELSE 'refund_pending' END,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'refund_reconciliation_hold') ||
      jsonb_build_object('provider_refund_status', v_status),
    updated_at = now()
  WHERE id = v_refund.id;

  IF v_status IN ('failed', 'needs-attention') THEN
    -- A failure arriving during an active claim must not be lost when
    -- the worker concludes on older evidence: bump the generation (the
    -- claim itself is never clobbered) so the worker's finish detects
    -- the fresh contradiction and requeues it for the next sweep. Runs
    -- before the reset below so a recycled row keeps generation 0.
    UPDATE public.paystack_cancellation_refund_notifications
    SET generation = generation + 1
    WHERE order_id = v_order.id
      AND merchant_id = v_order.merchant_id
      AND event_type = 'failed_merchant_push'
      AND status IN ('pending', 'processing');
    -- A later failure on another leg (or a contradictory failure after
    -- the order became refunded) must re-alert: reset a settled row to
    -- claimable. Queued rows already guarantee a covering alert.
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO UPDATE SET
      status = 'pending',
      attempts = 0,
      claimed_at = NULL,
      claim_token = NULL,
      last_error = NULL,
      sent_at = NULL,
      created_at = now(),
      generation = 0
    WHERE paystack_cancellation_refund_notifications.status IN
      ('sent', 'failed', 'delivery_uncertain');
    RETURN v_status;
  END IF;
  IF v_status <> 'processed' THEN RETURN v_status; END IF;

  -- Every funded external payment leg needs terminal refund evidence.
  -- Refund-state legs (e.g. PayPal flips the payment row itself to
  -- refund_pending while its provider refund is pending) have no
  -- separate refund row yet, so scanning only completed legs would
  -- mark the order refunded too early. Self-terminal refunded legs
  -- carry their own evidence and stay out of this scan.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions p
    WHERE p.order_id = v_order.id AND p.merchant_id = v_order.merchant_id
      AND p.transaction_type = 'payment' AND p.status IN ('completed', 'refund_pending')
      AND p.amount > 0
      AND COALESCE(public.normalized_gateway_name_v1(p.gateway), '') NOT IN
        ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
          AND r.transaction_type = 'refund'
          -- Normalize gateways exactly like the aggregate coverage
          -- gate (whitespace-trimmed, uppercased; missing gateways
          -- never match).
          AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)
          AND r.status = 'completed'
          AND r.amount > 0
          AND upper(btrim(r.currency)) = upper(btrim(p.currency))
          -- A locally completed Paystack refund counts only after this RPC
          -- provider-verified it; other gateways keep local-status trust.
          AND (
            public.normalized_gateway_name_v1(r.gateway) <> 'PAYSTACK'
            OR r.metadata->>'provider_refund_status' = 'processed'
          )
          AND (
            r.metadata->>'payment_transaction_id' = p.id::text
            OR (
              r.metadata->>'payment_transaction_id' IS NULL
              -- The unlinked legacy refund attributes to the sole
              -- completed leg only: a refund_pending leg is mid-flight
              -- with its own outstanding refund, so the same completed
              -- refund must not also satisfy it (or one verified
              -- refund would retire two legs while the second provider
              -- refund is still pending).
              AND p.status = 'completed'
              AND 1 = (
                SELECT count(*) FROM public.transactions only_payment
                 WHERE only_payment.order_id = v_order.id
                   AND only_payment.merchant_id = v_order.merchant_id
                   AND only_payment.transaction_type = 'payment'
                   AND only_payment.status = 'completed'
                   AND only_payment.amount > 0
                   AND COALESCE(public.normalized_gateway_name_v1(only_payment.gateway), '') NOT IN (
                     'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
                     'PAY_ON_DELIVERY'
                   )
              )
            )
          )
        -- Partial refunds accumulate: the leg is covered when matching
        -- rows sum to at least its amount, mirroring the executor rule.
        HAVING coalesce(sum(r.amount), 0) >= p.amount
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
          AND COALESCE(public.normalized_gateway_name_v1(funded.gateway), '') NOT IN
            ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
      )
    )
  ) THEN
    -- Every funded leg has terminal refund evidence: run the shared
    -- aggregate finalization (order transition, settlement reversal,
    -- notifications, review close).
    PERFORM public.finalize_refunded_cancellation_order_v1(
      v_order.id, v_order.merchant_id, v_refund.id
    );
  END IF;
  RETURN 'processed';
END;
$$;
