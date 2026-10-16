-- Reconciliation finalization predicate, extracted so the
-- record_verified override stays under the 300-line limit. The
-- same-gateway terminal scan below is peer's BNPL version verbatim
-- (same gateway, matching money, verified Paystack rows, legacy
-- refunded evidence, sole-leg attribution); the legs-covered arm
-- first admits manual-covered external legs, whose
-- merchant-attested rows the same-gateway scan cannot see. The
-- legs arm carries the same paid-family statuses, so BNPL keeps
-- its aggregate safety gates and the scan keeps its pending-funded
-- rule.
CREATE OR REPLACE FUNCTION private.reconciliation_should_finalize_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text,
  p_payment_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Total coverage gates every arm below: on a drifted order the
  -- funded rows can sum below amount_paid while per-leg scans
  -- pass, and finalizing then would mark the order refunded while
  -- the manager still reports an unreturnable outstanding
  -- balance. Same shared helper as the aggregate claim.
  IF private.total_refund_returned_v1(
    p_order_id, p_merchant_id, p_currency
  ) < COALESCE((
    SELECT o.amount_paid FROM public.orders o
     WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  ), 0) THEN
    RETURN false;
  END IF;
  -- A mixed order (manual-covered leg A, provider leg B) finishes
  -- its side effect as completed; when B settles, legs_covered
  -- sees A's manual row and finalizes the whole order instead of
  -- stranding settlement reversal, notifications, and review
  -- closure on a completed row the drain never reselects.
  IF private.cancellation_refund_legs_covered_v1(
    p_order_id, p_merchant_id, p_currency
  ) AND (
    p_payment_status IN ('paid', 'partially_paid', 'refunded', 'bnpl_approved')
    OR (
      p_payment_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM public.transactions funded
        WHERE funded.order_id = p_order_id AND funded.merchant_id = p_merchant_id
          AND funded.transaction_type = 'payment' AND funded.status = 'completed'
          AND funded.amount > 0
          AND coalesce(public.normalized_gateway_name_v1(funded.gateway), '') NOT IN
            ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
      )
    )
  ) THEN
    RETURN true;
  END IF;
  -- Every funded external payment leg needs terminal refund evidence.
  -- Refund-state legs (e.g. PayPal flips the payment row itself to
  -- refund_pending while its provider refund is pending) have no
  -- separate refund row yet, so scanning only completed legs would
  -- mark the order refunded too early. Self-terminal refunded legs
  -- carry their own evidence and stay out of this scan.
  RETURN (NOT EXISTS (
    SELECT 1 FROM public.transactions p
    WHERE p.order_id = p_order_id AND p.merchant_id = p_merchant_id
      AND p.transaction_type = 'payment' AND p.status IN ('completed', 'refund_pending')
      AND p.amount > 0
      AND coalesce(public.normalized_gateway_name_v1(p.gateway), '') NOT IN
        ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id = p_order_id AND r.merchant_id = p_merchant_id
          AND r.transaction_type = 'refund'
          -- Normalize gateways exactly like the aggregate coverage
          -- gate (whitespace-trimmed, uppercased; missing gateways
          -- never match).
          AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)
          -- Terminal evidence is completed or refunded (legacy
          -- provider-confirmed rows), mirroring the aggregate
          -- claim and the executor coverage rules.
          AND r.status IN ('completed', 'refunded')
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
                 WHERE only_payment.order_id = p_order_id
                   AND only_payment.merchant_id = p_merchant_id
                   AND only_payment.transaction_type = 'payment'
                   AND only_payment.status = 'completed'
                   AND only_payment.amount > 0
                   AND coalesce(public.normalized_gateway_name_v1(only_payment.gateway), '') NOT IN (
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
    p_payment_status IN ('paid', 'partially_paid', 'refunded')
    -- A wedged order (completed gateway legs the sweep never flipped to
    -- paid) stays merchant-cancellable: its funded legs were just refunded,
    -- so it must transition, reverse settlements, and notify like a paid
    -- order. Unfunded pending orders stay out.
    OR (
      p_payment_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM public.transactions funded
        WHERE funded.order_id = p_order_id AND funded.merchant_id = p_merchant_id
          AND funded.transaction_type = 'payment' AND funded.status = 'completed'
          AND funded.amount > 0
          AND coalesce(public.normalized_gateway_name_v1(funded.gateway), '') NOT IN
            ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY')
      )
    )
    -- BNPL admission additionally requires the aggregate safety
    -- gates: the scan above checks only per-leg terminal coverage,
    -- so without them an in-flight, anomalous, or unverified row
    -- would finalize (reversing settlement and notifying) while
    -- provider money can still settle.
    OR (
      p_payment_status = 'bnpl_approved'
      AND private.cancellation_refund_legs_covered_v1(
        p_order_id, p_merchant_id, p_currency)
    )));
END; $$;
REVOKE ALL ON FUNCTION private.reconciliation_should_finalize_v1(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.reconciliation_should_finalize_v1(uuid,uuid,text,text)
  TO service_role;
