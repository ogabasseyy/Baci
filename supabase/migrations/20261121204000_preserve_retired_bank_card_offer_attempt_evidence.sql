-- Preserve the retired attempt's provider domain and filter policy for
-- operations review while keeping the hosted checkout URL private.
CREATE OR REPLACE FUNCTION public.retire_bank_card_offer_initialization(
  p_review_id uuid, p_provider_confirmation text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review record;
  v_transaction_id uuid;
  v_provider_domain text;
  v_policy_hash text;
  v_had_checkout_url boolean;
BEGIN
  IF NULLIF(btrim(p_provider_confirmation), '') IS NULL OR length(p_provider_confirmation) > 500
    THEN RETURN false; END IF;
  SELECT id, merchant_id, order_id, txn_id, paystack_ref, metadata INTO v_review
  FROM public.reconciliation_review
  WHERE id = p_review_id AND issue_type = 'gateway_payment_wedge_requires_review'
    AND metadata->>'source' = 'bank_card_offer_initialization' AND resolved_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || v_review.order_id::text, 0));
  PERFORM 1 FROM public.orders WHERE id = v_review.order_id AND merchant_id = v_review.merchant_id
    AND payment_status = 'pending' AND cancelled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM private.bank_card_offer_payment_attempts a
  USING public.transactions t
  WHERE a.order_id = v_review.order_id AND a.transaction_id = v_review.txn_id
    AND t.id = a.transaction_id AND t.gateway_reference = v_review.paystack_ref
    AND t.merchant_id = v_review.merchant_id AND t.status = 'pending'
    AND t.order_id = v_review.order_id AND t.gateway = 'paystack' AND t.transaction_type = 'payment'
    AND (a.checkout_url IS NULL OR v_review.metadata->>'provider_status' IN ('failed', 'abandoned', 'cancelled', 'reversed'))
    AND a.verified_evidence IS NULL
  RETURNING a.transaction_id, a.provider_domain, a.policy_hash, a.checkout_url IS NOT NULL
    INTO v_transaction_id, v_provider_domain, v_policy_hash, v_had_checkout_url;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.transactions SET status = 'cancelled', updated_at = now() WHERE id = v_transaction_id;
  UPDATE public.orders SET payment_status = 'unpaid', updated_at = now() WHERE id = v_review.order_id;
  UPDATE public.reconciliation_review SET resolved_at = now(),
    metadata = metadata || jsonb_build_object(
      'provider_confirmation', p_provider_confirmation,
      'retired_attempt', jsonb_build_object(
        'provider_domain', v_provider_domain,
        'policy_hash', v_policy_hash,
        'had_checkout_url', v_had_checkout_url
      )
    )
    WHERE id = p_review_id;
  RETURN true;
END;
$$;
