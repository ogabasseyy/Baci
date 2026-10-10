-- Claim reference-only watches alongside ID-keyed ones. Reference
-- watches (provider_refund_id NULL) file the per-payment review the
-- reference-only path would have filed had the payment been settled
-- during its scans; ID-keyed handling is unchanged. Same signature:
-- OR REPLACE keeps the completion wrapper on the new body.
CREATE OR REPLACE FUNCTION public.claim_paystack_refund_recovery_watches_v1(
  p_transaction_id uuid,
  p_order_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_txn_gateway text;
  v_txn_reference text;
  v_txn_amount numeric := 0;
  v_order_merchant_id uuid;
  v_order_number text;
  v_order_cancelled_at timestamptz;
  v_order_shipping_status text;
  v_order_label text;
  v_watch record;
  v_evidence jsonb;
  v_refund_status text;
  v_provider_txn_id bigint;
  v_refund_amount numeric := 0;
  v_refund_currency text;
  v_evidence_key text;
  v_reason text;
  v_candidate jsonb;
  v_review_id uuid;
  v_merged boolean;
  v_claimed integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN RETURN 0; END IF;

  SELECT t.gateway, nullif(btrim(coalesce(t.gateway_reference, '')), ''),
    coalesce(t.amount, 0)
  INTO v_txn_gateway, v_txn_reference, v_txn_amount
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id;
  -- Normalized like the watch opener's confirming scan: an exact
  -- match would claim nothing for a legacy ` Paystack ` payment the
  -- opener already matched, stranding its watch open forever.
  IF NOT FOUND
    OR public.normalized_gateway_name_v1(v_txn_gateway)
      IS DISTINCT FROM 'PAYSTACK'
    OR v_txn_reference IS NULL THEN
    RETURN 0;
  END IF;

  SELECT o.merchant_id, o.order_number, o.cancelled_at, o.shipping_status
  INTO v_order_merchant_id, v_order_number, v_order_cancelled_at,
    v_order_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Taken after the caller's per-order lock; the opener takes only
  -- this reference lock, so the order is always order-then-reference
  -- and cannot deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_txn_reference, 0)
  );

  v_order_label := coalesce(
    nullif(btrim(coalesce(v_order_number, '')), ''),
    upper(left(p_order_id::text, 8))
  );
  v_candidate := jsonb_build_object(
    'payment_transaction_id', p_transaction_id,
    'order_id', p_order_id,
    'amount', v_txn_amount,
    'gateway_reference', v_txn_reference
  );

  FOR v_watch IN
    SELECT * FROM public.paystack_refund_recovery_watch
    WHERE paystack_ref = v_txn_reference AND status = 'open'
    ORDER BY created_at
    FOR UPDATE
  LOOP
    BEGIN
      -- Reference-only watches carry no refund ID: file the
      -- per-payment review the reference path would have filed, then
      -- claim. Failures fall into the handler below so the watch
      -- stays open for the sweep.
      IF v_watch.provider_refund_id IS NULL THEN
        PERFORM public.file_paystack_refund_reference_watch_claim_v1(
          p_transaction_id,
          p_order_id,
          v_txn_reference,
          coalesce(
            nullif(btrim(coalesce(
              v_watch.evidence->>'provider_refund_status', '')), ''),
            'unknown')
        );
        UPDATE public.paystack_refund_recovery_watch
          SET status = 'claimed', updated_at = now()
          WHERE id = v_watch.id;
        v_claimed := v_claimed + 1;
        CONTINUE;
      END IF;
      v_evidence := coalesce(v_watch.evidence, '{}'::jsonb);
      v_refund_status := coalesce(
        nullif(btrim(
          coalesce(v_evidence->>'provider_refund_status', '')), ''),
        'unknown');
      IF v_evidence->>'provider_payment_transaction_id' ~ '^[0-9]+$'
        AND length(v_evidence->>'provider_payment_transaction_id') <= 18
      THEN
        v_provider_txn_id :=
          (v_evidence->>'provider_payment_transaction_id')::bigint;
      ELSE
        v_provider_txn_id := NULL;
      END IF;
      IF v_evidence->>'amount_minor' ~ '^[0-9]+$'
        AND length(v_evidence->>'amount_minor') <= 18
      THEN
        v_refund_amount := (v_evidence->>'amount_minor')::numeric / 100;
      ELSE
        v_refund_amount := 0;
      END IF;
      v_refund_currency :=
        coalesce(nullif(btrim(coalesce(
          v_evidence->>'currency', '')), ''), 'unknown');
      v_evidence_key := 'provider:' || v_watch.provider_refund_id::text;

      -- Mirrors the recovery filers' cancellation gate: verified
      -- refunds on active orders are merchant evidence, not
      -- cancellation evidence, and must not absorb a future genuine
      -- cancellation's queue entry.
      IF v_order_cancelled_at IS NOT NULL
        AND lower(coalesce(v_order_shipping_status, ''))
          IN ('cancelled', 'canceled') THEN
        v_reason := format(
          'Paystack refund %s verified for reference %s while its payment was still pending; the payment has now completed — reconcile the verified refund',
          v_watch.provider_refund_id, v_txn_reference);
        -- Payload mirrors file-paystack-refund-recovery-review: the
        -- audit-blocking reader keys failed-only exclusion on marked
        -- entries carrying the leg id and provider verdict.
        SELECT public.file_paystack_refund_recovery_review_v1(
          p_order_id,
          v_order_merchant_id,
          NULL,
          v_reason,
          jsonb_build_array(v_candidate),
          jsonb_build_object(
            'provider_refund_id', v_watch.provider_refund_id,
            'provider_payment_transaction_id', v_provider_txn_id,
            'reference', v_txn_reference,
            'audit_record_failed', true,
            'recovered_from_provider_event', true,
            'refund_evidence', jsonb_build_object(
              v_evidence_key, jsonb_build_object(
                'audit_record_failed', true,
                'payment_transaction_id', NULL,
                'provider_refund_status', v_refund_status,
                'candidate_payment_transaction_ids',
                  jsonb_build_array(p_transaction_id),
                'reason', left(v_reason, 120),
                'observed_at', now()
              )
            )
          )
        ) INTO v_review_id;
        IF v_review_id IS NULL THEN
          RAISE EXCEPTION 'recovery review filing failed';
        END IF;
      ELSE
        v_reason := format(
          'Paystack refund %s was verified for active order #%s; reconcile the order and its settlement before fulfillment',
          v_watch.provider_refund_id, v_order_label);
        -- Payload mirrors file-provider-refund-outside-cancellation-review.
        BEGIN
          INSERT INTO public.reconciliation_review (
            issue_type, order_id, merchant_id, paystack_ref, txn_id,
            reason, candidates, metadata
          ) VALUES (
            'provider_refund_outside_cancellation', p_order_id,
            v_order_merchant_id, NULL, NULL, v_reason,
            jsonb_build_array(v_candidate),
            jsonb_build_object(
              'provider_refund_id', v_watch.provider_refund_id,
              'provider_payment_transaction_id', v_provider_txn_id,
              'payment_transaction_id', p_transaction_id,
              'refund_evidence', jsonb_build_object(
                v_evidence_key, jsonb_build_object(
                  'payment_transaction_id', p_transaction_id,
                  'provider_payment_transaction_id', v_provider_txn_id,
                  'provider_refund_status', v_refund_status,
                  'refund_amount', v_refund_amount,
                  'refund_currency', v_refund_currency,
                  'reason', left(v_reason, 120),
                  'observed_at', now()
                )
              )
            )
          );
        EXCEPTION WHEN unique_violation THEN
          -- A concurrent filing won the open-by-order index: merge
          -- into it instead of dropping the evidence.
          SELECT public.merge_provider_refund_outside_cancellation_evidence_v1(
            p_order_id,
            v_order_merchant_id,
            v_evidence_key,
            jsonb_build_object(
              'payment_transaction_id', p_transaction_id,
              'provider_payment_transaction_id', v_provider_txn_id,
              'provider_refund_status', v_refund_status,
              'refund_amount', v_refund_amount,
              'refund_currency', v_refund_currency,
              'reason', left(v_reason, 120),
              'observed_at', now()
            ),
            jsonb_build_array(v_candidate)
          ) INTO v_merged;
          IF v_merged IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'outside-cancellation merge failed';
          END IF;
        END;
      END IF;

      UPDATE public.paystack_refund_recovery_watch
        SET status = 'claimed', updated_at = now()
        WHERE id = v_watch.id;
      v_claimed := v_claimed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Filing must never fail the payment completion: the watch
      -- stays open and the recovery sweep re-drives it.
      RAISE WARNING 'paystack refund watch % claim skipped: %',
        v_watch.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_paystack_refund_recovery_watches_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_refund_recovery_watches_v1(uuid,uuid)
  TO service_role;
