-- Count merchant-attested manual refunds as coverage in the aggregate
-- claim. Manual rows link explicitly (payment_transaction_id) and carry
-- their leg's currency, so a fully manual refund now runs the trusted
-- finalization (order transition, settlement reversal, notifications,
-- review close) instead of stranding the order paid. Partial manual
-- coverage still leaves the legs uncovered, and the executor matcher
-- mirrors this rule so both gates agree.
CREATE OR REPLACE FUNCTION public.claim_order_cancellation_side_effect(
  p_order_id uuid,
  p_step text,
  p_claim_token uuid
) RETURNS TABLE (we_won boolean, current_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_step NOT IN ('refund', 'customer_email') OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_cancellation_side_effect';
  END IF;

  SELECT o.merchant_id
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND (
       o.shipping_status IN ('cancelled', 'canceled')
       OR o.cancelled_at IS NOT NULL
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancelled_order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_step = 'refund' AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = v_order.merchant_id
       AND t.transaction_type = 'payment'
       -- Funded legs plus self-terminal refunds: when every external leg
       -- sits in refund_pending (e.g. a PayPal-only cancellation awaiting
       -- provider completion), the side effect must still be reclaimable
       -- so the drain resumes it instead of 503ing on
       -- refund_not_required every five minutes. Fully refunded legs
       -- (PayPal terminalizes the payment row itself) also pass: the
       -- executor finds no actionable legs and completes the row instead
       -- of stranding it behind a rejection.
       AND t.status IN ('completed', 'refund_pending', 'refunded')
       AND t.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(t.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
  ) THEN
    RAISE EXCEPTION 'refund_not_required';
  END IF;

  UPDATE public.order_cancellation_side_effects AS side_effect
     SET status = 'delivery_uncertain',
         error = 'Claim expired before completion; delivery requires reconciliation'
   WHERE side_effect.order_id = p_order_id
     AND side_effect.step = p_step
     AND side_effect.status = 'claimed'
     AND side_effect.claimed_at < now() - interval '5 minutes';

  IF p_step = 'refund' AND NOT EXISTS (
    SELECT 1
      FROM public.transactions payment
     WHERE payment.order_id = p_order_id
       AND payment.merchant_id = v_order.merchant_id
       AND payment.transaction_type = 'payment'
       -- Mirror the completion gate's funded-leg statuses: refund-state
       -- legs (e.g. PayPal flips the payment row itself to refund_pending
       -- while its provider refund is pending) have no separate refund
       -- row yet, so scanning only completed legs would complete the
       -- side effect while the order stays paid with no worker resuming
       -- the outstanding refund.
       AND payment.status IN ('completed', 'refund_pending')
       AND payment.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(payment.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.transactions refund
          WHERE refund.order_id = p_order_id
            AND refund.merchant_id = v_order.merchant_id
            AND refund.transaction_type = 'refund'
            -- Normalize gateways exactly like the executor's linked path
            -- (whitespace-trimmed, uppercased; missing gateways never
            -- match): exact equality would leave a legacy `Paystack` leg
            -- uncovered here while the executor treats its `paystack`
            -- refund as covering it, stranding the order paid with no
            -- aggregate finalization.
            -- Terminal refund evidence is completed or refunded (legacy
            -- provider-confirmed rows): both count as returned money,
            -- mirroring the manager and the status trigger.
            AND refund.status IN ('completed', 'refunded')
            AND refund.amount > 0
            AND upper(btrim(refund.currency)) = upper(btrim(payment.currency))
            -- A locally completed Paystack refund counts only after it is
            -- provider-verified; other gateways keep local-status trust.
            -- Normalized like the gateway match above so a legacy
            -- `Paystack` row cannot slip through unverified while the
            -- executor (which normalizes) waits for verification. The
            -- normalizer maps missing gateways to NULL, keeping them
            -- strict, as before.
            AND (
              (
                public.normalized_gateway_name_v1(refund.gateway) = public.normalized_gateway_name_v1(payment.gateway)
                AND (
                  public.normalized_gateway_name_v1(refund.gateway) <> 'PAYSTACK'
                  OR refund.metadata->>'provider_refund_status' = 'processed'
                )
            AND (
              refund.metadata->>'payment_transaction_id' = payment.id::text
              OR (
                refund.metadata->>'payment_transaction_id' IS NULL
                -- As in the completion gate: the unlinked refund
                -- attributes to the sole completed leg only, never to a
                -- refund_pending leg whose own provider refund is still
                -- outstanding.
                AND payment.status = 'completed'
                AND 1 = (
                  SELECT count(*) FROM public.transactions only_payment
                   WHERE only_payment.order_id = p_order_id
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
              -- Merchant-attested manual rows link explicitly and count as
              -- coverage in matching money, mirroring the executor
              -- matcher; they never sole-attribute, so an unlinked manual
              -- row stays out of coverage for review.
              OR (
                public.normalized_gateway_name_v1(refund.gateway) = 'MANUAL'
                AND refund.metadata->>'payment_transaction_id' = payment.id::text
              )
            )
            )
          -- Partial refunds accumulate: the leg is covered when matching
          -- rows sum to at least its amount, mirroring the executor rule.
          HAVING coalesce(sum(refund.amount), 0) >= payment.amount
       )
  ) THEN
    -- Every funded leg has terminal refund evidence, but the last leg may
    -- have landed through a silent self-terminal refund no worker
    -- observes: run the aggregate finalization (order transition,
    -- settlement reversal, notifications, review close) before
    -- completing the row, or the order stays paid permanently.
    PERFORM public.finalize_refunded_cancellation_order_v1(
      p_order_id, v_order.merchant_id, NULL
    );
    INSERT INTO public.order_cancellation_side_effects AS side_effect (
      order_id, merchant_id, step, status, claim_token, completed_at, attempts
    ) VALUES (
      p_order_id, v_order.merchant_id, p_step, 'completed',
      p_claim_token, now(), 0
    )
    ON CONFLICT (order_id, step) DO UPDATE SET
      status = 'completed',
      completed_at = COALESCE(side_effect.completed_at, now()),
      error = NULL;
  ELSE
    INSERT INTO public.order_cancellation_side_effects AS side_effect (
      order_id, merchant_id, step, status, claim_token, attempts
    ) VALUES (
      p_order_id, v_order.merchant_id, p_step, 'claimed', p_claim_token, 1
    )
    ON CONFLICT (order_id, step) DO UPDATE SET
      status = 'claimed', claim_token = EXCLUDED.claim_token,
      claimed_at = now(), completed_at = NULL, error = NULL,
      attempts = CASE WHEN side_effect.status = 'deferred'
                      THEN side_effect.attempts
                      ELSE side_effect.attempts + 1 END
    WHERE (side_effect.status = 'failed' AND side_effect.attempts < 5)
       OR side_effect.status = 'deferred';
  END IF;

  RETURN QUERY
  SELECT side_effect.claim_token = p_claim_token
           AND side_effect.status = 'claimed',
         side_effect.status
    FROM public.order_cancellation_side_effects side_effect
   WHERE side_effect.order_id = p_order_id
     AND side_effect.step = p_step;
END;
$$;

