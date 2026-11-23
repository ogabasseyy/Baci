-- The scheduled worker must continue checking saved captures after the
-- order is paid. Keep its retry clock on the private attempt.
ALTER TABLE private.bank_card_offer_payment_attempts
  ADD COLUMN paid_recheck_after timestamptz NOT NULL DEFAULT now();

CREATE INDEX bank_card_offer_paid_recheck_due_idx
  ON private.bank_card_offer_payment_attempts (paid_recheck_after, transaction_id)
  WHERE verified_evidence IS NOT NULL;

CREATE FUNCTION public.claim_paid_bank_card_offer_recheck()
RETURNS TABLE (
  transaction_id uuid, order_id uuid, merchant_id uuid, gateway_reference text
) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH eligible AS (
    SELECT a.transaction_id, a.order_id, t.merchant_id, t.gateway_reference
    FROM private.bank_card_offer_payment_attempts a
    JOIN public.transactions t ON t.id = a.transaction_id AND t.order_id = a.order_id
    JOIN public.orders o ON o.id = a.order_id AND o.merchant_id = t.merchant_id
    WHERE a.paid_recheck_after <= now() AND a.verified_evidence IS NOT NULL
      AND t.transaction_type = 'payment' AND t.gateway = 'paystack' AND t.status = 'completed'
      AND t.gateway_reference ~ '^BCO-[a-f0-9]{32}$'
      AND o.payment_method = 'bank_card_offer' AND o.payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review r
        WHERE r.txn_id = t.id AND r.order_id = o.id AND r.merchant_id = t.merchant_id
          AND r.paystack_ref = t.gateway_reference
          AND r.issue_type = 'gateway_payment_wedge_requires_review'
          AND r.metadata->>'source' = 'bank_card_offer_initialization'
          AND r.metadata->>'provider_status' = 'reversed'
      )
    ORDER BY a.paid_recheck_after, a.transaction_id
    LIMIT 1 FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE private.bank_card_offer_payment_attempts a
    SET paid_recheck_after = now() + interval '50 minutes'
    FROM eligible e WHERE a.transaction_id = e.transaction_id
    RETURNING e.transaction_id, e.order_id, e.merchant_id, e.gateway_reference
  )
  SELECT c.transaction_id, c.order_id, c.merchant_id, c.gateway_reference FROM claimed c;
$$;
REVOKE ALL ON FUNCTION public.claim_paid_bank_card_offer_recheck()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_paid_bank_card_offer_recheck() TO service_role;
