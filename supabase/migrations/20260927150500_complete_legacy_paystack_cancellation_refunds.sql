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
  v_settlement public.merchant_settlements%ROWTYPE;
  v_direct_split boolean;
  v_balance numeric;
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
  -- through: persist the provider status, notify, and rotate updated_at below.
  -- Nonterminal verdicts (pending/processing/needs-attention) keep a
  -- completed row completed so the legacy recheck keeps verifying it:
  -- demoting to refund_pending would strand legacy rows that lack the
  -- cancellation description the pending worker requires, leaving them
  -- selected by neither worker.
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN RETURN 'already_failed'; END IF;
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
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
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
      AND coalesce(p.gateway, '') NOT IN
        ('wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
          AND r.transaction_type = 'refund' AND r.gateway = p.gateway
          AND r.status = 'completed'
          AND r.amount = p.amount
          AND upper(r.currency) = upper(p.currency)
          -- A locally completed Paystack refund counts only after this RPC
          -- provider-verified it; other gateways keep local-status trust.
          AND (
            r.gateway <> 'paystack'
            OR r.metadata->>'provider_refund_status' = 'processed'
          )
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
    -- Reverse the order's settlements atomically with the refund
    -- transition. This branch runs only once every funded external leg
    -- has terminal refund evidence, so every gateway leg behind these
    -- rows is refunded — including non-Paystack legs in mixed-gateway
    -- cancellations. process_due_settlements never joins order state, so
    -- a pending row would otherwise credit the merchant after the
    -- customer was refunded, while settled funds would remain in
    -- available balance. Already-cancelled rows (re-entry on a refunded
    -- order) match nothing.
    FOR v_settlement IN
      SELECT settlement.* FROM public.merchant_settlements AS settlement
      WHERE settlement.merchant_id = v_order.merchant_id
        AND settlement.source_type = 'order'
        AND settlement.source_id = v_order.id
        AND settlement.status IN ('pending', 'processing', 'settled')
      FOR UPDATE
    LOOP
      -- Direct-split settlements settled straight to the merchant's Paystack
      -- subaccount and never credited the Baci wallet: cancel the row below
      -- without moving wallet balances that were never credited.
      v_direct_split := COALESCE(
        v_settlement.metadata ->> 'redvault_direct_split', 'false'
      ) = 'true';
      IF NOT v_direct_split THEN
        IF v_settlement.status IN ('pending', 'processing') THEN
          UPDATE public.merchant_wallets
          SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
              upcoming_count = greatest(0, upcoming_count - 1),
              updated_at = now()
          WHERE id = v_settlement.wallet_id;
        ELSE
          UPDATE public.merchant_wallets
          SET available_balance = available_balance - v_settlement.net_amount,
              total_earned = total_earned - v_settlement.net_amount,
              updated_at = now()
          WHERE id = v_settlement.wallet_id
          RETURNING available_balance INTO v_balance;
          IF v_balance IS NULL THEN
            RAISE EXCEPTION 'refund_settlement_wallet_missing';
          END IF;
          INSERT INTO public.wallet_transactions (
            wallet_id, merchant_id, type, amount, balance_after,
            source_type, source_id, description, status, metadata
          ) VALUES (
            v_settlement.wallet_id, v_settlement.merchant_id, 'refund',
            v_settlement.net_amount, v_balance, 'refund', v_refund.id,
            v_settlement.gateway || ' cancellation refund settlement reversal',
            'completed',
            jsonb_build_object('settlement_id', v_settlement.id, 'order_id', v_order.id)
          );
        END IF;
      END IF;
      UPDATE public.merchant_settlements
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_settlement.id;
    END LOOP;
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'processed_customer_email'),
           (v_order.id, v_order.merchant_id, 'processed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    -- Every payment leg is provider-verified complete, so the cancellation
    -- saga is done regardless of which metadata shape the open reviews
    -- carry (top-level IDs, accepted leg lists, or merged evidence).
    -- Reviews that record a provider-accepted refund with no local audit row
    -- (audit_record_failed) stay open until their provider refund ID matches
    -- a completed local refund row: closing them on other legs' evidence
    -- would drop an unreconciled customer refund.
    UPDATE public.reconciliation_review review
      SET resolved_at = now(),
          resolution_notes = 'Paystack verified all cancelled-order gateway refunds'
      WHERE review.order_id = v_order.id
        AND review.merchant_id = v_order.merchant_id
        AND review.issue_type = 'order_cancellation_refund_requires_review'
        AND review.resolved_at IS NULL
        AND (
          review.metadata->>'audit_record_failed' IS DISTINCT FROM 'true'
          OR EXISTS (
            SELECT 1 FROM public.transactions r
            WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
              AND r.transaction_type = 'refund' AND r.gateway = 'paystack'
              AND r.status = 'completed'
              AND r.gateway_reference = review.metadata->>'provider_refund_id'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_each(coalesce(review.metadata->'refund_evidence', '{}'::jsonb)) AS e(key, value)
          WHERE (e.value->>'audit_record_failed')::boolean IS TRUE
            AND e.key LIKE 'provider:%'
            AND NOT EXISTS (
              SELECT 1 FROM public.transactions r
              WHERE r.order_id = v_order.id AND r.merchant_id = v_order.merchant_id
                AND r.transaction_type = 'refund' AND r.gateway = 'paystack'
                AND r.status = 'completed'
                AND r.gateway_reference = split_part(e.key, ':', 2)
            )
        );
  END IF;
  RETURN 'processed';
END;
$$;
