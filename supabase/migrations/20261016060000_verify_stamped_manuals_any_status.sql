-- Accept stamped manuals in the transition regardless of the last
-- verdict, locking the order before the refund row.
--
-- The sweep reselects stamped manuals after a contradiction, so the
-- transition must too or the recheck dies at refund_not_found before
-- the recovery verdict can land. Stamped manuals match by numeric
-- stored provider id whatever the last verdict was; the payment
-- linkage, amount, and currency checks bind the row to its Paystack
-- capture unchanged. The order row locks before the refund row,
-- matching the manager's order-first discipline: the reverse order
-- deadlocks against a concurrent manual-record retry (order lock,
-- then refund-row write) when both touch the same order, turning a
-- legitimate replay or reconciliation attempt into a 500/retry. Body
-- otherwise unchanged from 20261016040000 (predicate finalization,
-- delivery-uncertain sync, repeat rotation); no signature change.
-- Split from 20261016050000 for the 300-line modularity gate.
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
  v_order_id uuid;
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

  -- Order id first, unlocked: the order lock below must precede the
  -- refund-row lock, and only the row knows its order. The row
  -- predicate still evaluates under its own FOR UPDATE, so a
  -- concurrent metadata change cannot slip an unqualified row in.
  SELECT order_id INTO v_order_id FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund';
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.cancelled_at IS NULL OR v_order.shipping_status NOT IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;

  SELECT * INTO v_refund FROM public.transactions
    WHERE id = p_refund_id AND transaction_type = 'refund'
      -- Legacy cancellation refunds may store `Paystack` or padding;
      -- the id filter already binds the row, so normalize instead of
      -- an exact match that would hold verified refunds out of polling.
      -- Stamped manuals (numeric stored provider id, mirroring the
      -- sweep predicate) verify like provider rows whatever the last
      -- verdict was: the payment linkage, amount, and currency checks
      -- below bind the row to its Paystack capture unchanged.
      AND (public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
        AND gateway_reference ~ '^[0-9]+$'
        OR (public.normalized_gateway_name_v1(gateway) = 'MANUAL'
          AND metadata->>'provider_refund_id' ~ '^[0-9]+$')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_order.merchant_id <> v_refund.merchant_id THEN
    RAISE EXCEPTION 'refund_order_mismatch';
  END IF;
  SELECT * INTO v_payment FROM public.transactions
    WHERE id = (v_refund.metadata->>'payment_transaction_id')::uuid
      AND order_id = v_order.id AND merchant_id = v_order.merchant_id
      AND transaction_type = 'payment'
      -- Normalize like the aggregate coverage gate: a legacy `Paystack`
      -- leg and its `paystack` refund must verify together. Missing or
      -- blank gateways never match.
      AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
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
        AND coalesce(public.normalized_gateway_name_v1(gateway), '') NOT IN
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
  IF v_refund.status = 'failed' AND v_status <> 'processed' THEN
    -- Legacy failed rows predate the notification table, and the
    -- periodic refund workers exclude failed rows: without this insert
    -- the first verified failure verdict is acknowledged without ever
    -- notifying the merchant. Queued rows already guarantee a covering
    -- alert, and settled rows prove the merchant was notified, so the
    -- conflict does nothing and repeat verdicts never re-alert.
    INSERT INTO public.paystack_cancellation_refund_notifications
      (order_id, merchant_id, event_type)
    VALUES (v_order.id, v_order.merchant_id, 'failed_merchant_push')
    ON CONFLICT (order_id, event_type) DO NOTHING;
    -- Round-61 P1: persist the repeat verdict as the row's provider
    -- stamp before returning. The gates treat an unstamped failed
    -- row as live (processed can still resurrect it); without this
    -- write a confirming verdict would never clear them.
    UPDATE public.transactions SET
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('provider_refund_status', v_status),
      updated_at = now()
    WHERE id = v_refund.id;
    RETURN 'already_failed';
  END IF;
  -- A repeat verdict is a no-op only when this leg already reflects
  -- it and the order's failure alert is durable. Legacy rows stored
  -- the verdict while staying in pending: returning early would skip
  -- the transition and the alert forever while the pending sweep
  -- reselects the row indefinitely. Failed rows return above, so a
  -- failed verdict here always needs its transition — except on a
  -- terminal completed row whose contradiction is already surfaced.
  -- Needs-attention settles at refund_pending. Still rotate the row
  -- so reviewed rows cannot pin the workers' oldest-25 batch.
  IF v_status IN ('failed', 'needs-attention')
    AND v_refund.metadata->>'provider_refund_status' = v_status
    AND (
      (v_status = 'failed' AND v_refund.status = 'completed')
      OR (v_status = 'needs-attention'
          AND v_refund.status IN ('refund_pending', 'completed'))
    )
    AND EXISTS (
      SELECT 1 FROM public.paystack_cancellation_refund_notifications n
      WHERE n.order_id = v_order.id
        AND n.merchant_id = v_order.merchant_id
        AND n.event_type = 'failed_merchant_push'
    ) THEN
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

  -- Same-gateway terminal scan plus the shared legs-covered
  -- gate for manual-covered legs (see the predicate helper).
  IF private.reconciliation_should_finalize_v1(
    v_order.id, v_order.merchant_id, v_order.currency, v_order.payment_status
  ) THEN
    -- Every funded leg has terminal refund evidence: run the shared
    -- aggregate finalization (order transition, settlement reversal,
    -- notifications, review close).
    PERFORM public.finalize_refunded_cancellation_order_v1(
      v_order.id, v_order.merchant_id, v_refund.id
    );
    -- Reconciliation finalized the money: a delivery-uncertain side
    -- effect would otherwise report requires_review (and stop panel
    -- polling) forever despite complete coverage. Complete it once
    -- no review still needs a human.
    UPDATE public.order_cancellation_side_effects
       SET status = 'completed',
           completed_at = COALESCE(completed_at, now()),
           error = NULL
     WHERE order_id = v_order.id AND step = 'refund'
       AND status = 'delivery_uncertain'
       AND NOT EXISTS (
         SELECT 1 FROM public.reconciliation_review rr
          WHERE rr.order_id = v_order.id
            AND rr.resolved_at IS NULL);
  END IF;
  RETURN 'processed';
END;
$$;
