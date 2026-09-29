-- Flag cancelled orders whose completed refunds exceed a payment leg.
-- The coverage check treats any total at or above the leg amount as
-- ordinary full coverage, so a second verified (or manually created)
-- refund on an already fully refunded leg would finalize the order and
-- close its reviews without any durable signal that the merchant was
-- debited twice. The refunded transition still runs; this queue keeps
-- the excess visible to operations until resolved.

ALTER TABLE public.reconciliation_review
  DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check;

ALTER TABLE public.reconciliation_review
  ADD CONSTRAINT reconciliation_review_issue_type_check CHECK (issue_type IN (
    'payment_match_ambiguous',
    'payment_match_zero_candidates',
    'manage_stock_cancellation_held',
    'tax_basis_unclassified',
    'tax_basis_inconsistent_total',
    'wallet_dva_order_alias_conflict',
    'wallet_dva_order_payment_replay',
    'customer_savings_auto_debit_allocation_failed',
    'wallet_order_funding_ambiguous',
    'wallet_order_funding_conflict',
    'wallet_order_funding_finalize_failed',
    'payment_received_after_cancellation',
    'payment_received_after_refund',
    'serialized_inventory_confirmation_failed',
    'merchant_settlement_failed',
    'gateway_payment_wedge_requires_review',
    'credit_direct_confirmation_missing',
    'order_cancellation_refund_requires_review',
    'paypal_capture_persist_failed',
    'merchant_invoice_partial_payment_conflict',
    'merchant_wallet_assignment_review',
    'gigl_wallet_shipping_charge_ambiguous',
    'shipment_booked_after_full_refund',
    'duplicate_payment_capture_requires_review',
    'abandoned_attempt_evidence_mismatch',
    'provider_refund_outside_cancellation',
    'order_cancellation_over_refund_requires_review'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

CREATE FUNCTION public.flag_paystack_cancellation_over_refunds_v1(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_legs jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Funded external legs whose completed refunds exceed the leg amount.
  -- Mirrors the coverage check's leg/refund matching in
  -- record_verified_paystack_cancellation_refund_v1 so only genuine
  -- same-leg, same-currency, provider-verified excess flags.
  SELECT jsonb_agg(to_jsonb(excess)) INTO v_legs
  FROM (
    SELECT p.id AS payment_transaction_id,
           p.gateway_reference AS payment_reference,
           p.amount AS payment_amount,
           p.currency AS payment_currency,
           coalesce(sum(r.amount), 0) AS refunded_amount
      FROM public.transactions p
      LEFT JOIN public.transactions r
        ON r.order_id = p.order_id AND r.merchant_id = p.merchant_id
       AND r.transaction_type = 'refund' AND r.gateway = p.gateway
       AND r.status = 'completed'
       AND r.amount > 0
       AND upper(r.currency) = upper(p.currency)
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
              WHERE only_payment.order_id = p.order_id
                AND only_payment.merchant_id = p.merchant_id
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
     WHERE p.order_id = p_order_id AND p.merchant_id = p_merchant_id
       AND p.transaction_type = 'payment'
       AND p.status IN ('completed', 'refund_pending')
       AND p.amount > 0
       AND coalesce(p.gateway, '') NOT IN (
         'wallet', 'savings', 'store_credit', 'cash', 'manual',
         'pay_on_delivery'
       )
     GROUP BY p.id, p.gateway_reference, p.amount, p.currency
    HAVING coalesce(sum(r.amount), 0) > p.amount
  ) AS excess;
  IF v_legs IS NULL THEN RETURN; END IF;
  INSERT INTO public.reconciliation_review
    (issue_type, order_id, merchant_id, reason, candidates, metadata)
  VALUES (
    'order_cancellation_over_refund_requires_review',
    p_order_id,
    p_merchant_id,
    'One or more payment legs were refunded above their payment amount; verify the excess with the provider before closing',
    v_legs,
    jsonb_build_object('over_refunded_legs', v_legs)
  )
  -- An open over-refund review already signals operations; concurrent
  -- finalizations must not duplicate it.
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_paystack_cancellation_over_refunds_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_paystack_cancellation_over_refunds_v1(uuid,uuid)
  TO service_role;
