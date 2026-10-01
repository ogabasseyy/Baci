-- File a claimed reference-only watch as the per-payment review the
-- reference-only path would have filed had the payment been settled
-- during its scans. Called by the watch claim inside the completion
-- transaction; raises on any failure so the caller leaves the watch
-- open for the sweep instead of claiming unfiled evidence.
CREATE FUNCTION public.file_paystack_refund_reference_watch_claim_v1(
  p_transaction_id uuid,
  p_order_id uuid,
  p_reference text,
  p_refund_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_txn_amount numeric := 0;
  v_txn_currency text;
  v_order_merchant_id uuid;
  v_order_number text;
  v_order_cancelled_at timestamptz;
  v_order_shipping_status text;
  v_order_label text;
  v_reason text;
  v_candidate jsonb;
  v_evidence_key text;
  v_evidence jsonb;
  v_slug text;
  v_review_id uuid;
  v_merged boolean;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL
    OR nullif(btrim(coalesce(p_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid reference watch claim';
  END IF;

  SELECT coalesce(t.amount, 0), t.currency
  INTO v_txn_amount, v_txn_currency
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim payment not found'; END IF;

  SELECT o.merchant_id, o.order_number, o.cancelled_at, o.shipping_status
  INTO v_order_merchant_id, v_order_number, v_order_cancelled_at,
    v_order_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim order not found'; END IF;

  v_order_label := coalesce(
    nullif(btrim(coalesce(v_order_number, ''))),
    upper(left(p_order_id::text, 8))
  );

  IF v_order_cancelled_at IS NOT NULL
    AND lower(coalesce(v_order_shipping_status, ''))
      IN ('cancelled', 'canceled') THEN
    -- Payload mirrors file-reference-only-paystack-refund-review.
    v_reason := format(
      'Paystack refund event for payment %s has no local audit row; verify the provider refund before another is initiated',
      p_reference);
    SELECT public.file_paystack_refund_recovery_review_v1(
      p_order_id,
      v_order_merchant_id,
      NULL,
      v_reason,
      jsonb_build_array(jsonb_build_object(
        'amount', v_txn_amount,
        'currency', v_txn_currency,
        'gateway', 'paystack',
        'gatewayReference', p_reference,
        'paymentTransactionId', p_transaction_id
      )),
      jsonb_build_object(
        'audit_record_failed', true,
        'payment_transaction_id', p_transaction_id,
        'reference', p_reference,
        'reference_only_refund_event', true,
        'refund_evidence', jsonb_build_object(
          'reference:' || p_reference, jsonb_build_object(
            'audit_record_failed', true,
            'payment_transaction_id', p_transaction_id,
            'provider_refund_status', p_refund_status
          )
        )
      )
    ) INTO v_review_id;
    IF v_review_id IS NULL THEN
      RAISE EXCEPTION 'reference watch recovery review filing failed';
    END IF;
    RETURN;
  END IF;

  -- Payload mirrors
  -- file-reference-only-paystack-refund-outside-cancellation-review,
  -- including the verdict-suffixed evidence key: without the suffix,
  -- a later genuine refund for the same payment would overwrite an
  -- earlier failed one (or vice versa) under one key.
  v_slug := regexp_replace(
    lower(coalesce(p_refund_status, '')), '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
  v_slug := left(v_slug, 32);
  IF v_slug IS NULL OR btrim(v_slug) = '' THEN v_slug := 'unknown'; END IF;
  v_reason := format(
    'Paystack refund event for payment %s on active order #%s has no local audit row; verify the provider refund before fulfillment or settlement',
    p_reference, v_order_label);
  v_candidate := jsonb_build_object(
    'amount', v_txn_amount,
    'currency', v_txn_currency,
    'gateway', 'paystack',
    'gatewayReference', p_reference,
    'order_id', p_order_id,
    'payment_transaction_id', p_transaction_id
  );
  v_evidence_key :=
    'payment:' || p_transaction_id::text || ':' || v_slug;
  v_evidence := jsonb_build_object(
    'audit_record_failed', true,
    'payment_transaction_id', p_transaction_id,
    'payment_reference', p_reference,
    'payment_amount', v_txn_amount,
    'payment_currency', v_txn_currency,
    'provider_refund_status', p_refund_status,
    'reference_only_refund_event', true,
    'reason', left(v_reason, 120),
    'observed_at', now()
  );
  BEGIN
    INSERT INTO public.reconciliation_review (
      issue_type, order_id, merchant_id, paystack_ref, txn_id,
      reason, candidates, metadata
    ) VALUES (
      'provider_refund_outside_cancellation', p_order_id,
      v_order_merchant_id, NULL, NULL, v_reason,
      jsonb_build_array(v_candidate),
      jsonb_build_object(
        'audit_record_failed', true,
        'payment_transaction_id', p_transaction_id,
        'reference', p_reference,
        'reference_only_refund_event', true,
        'refund_evidence', jsonb_build_object(
          v_evidence_key, v_evidence
        )
      )
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT public.merge_provider_refund_outside_cancellation_evidence_v1(
      p_order_id,
      v_order_merchant_id,
      v_evidence_key,
      v_evidence,
      jsonb_build_array(v_candidate)
    ) INTO v_merged;
    IF v_merged IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'reference watch outside-cancellation merge failed';
    END IF;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.file_paystack_refund_reference_watch_claim_v1(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_paystack_refund_reference_watch_claim_v1(uuid,uuid,text,text)
  TO service_role;
