-- Make watch-evidence refreshes verdict-sticky. Both openers
-- refresh the watched evidence when a redelivery collides with the
-- open row; a delayed failed observation would overwrite an earlier
-- processed one, and the claim would then file failed-only evidence
-- that audit blocking excludes — unblocking a leg a processed refund
-- was observed for. Known non-failed verdicts now survive later
-- failed (or verdict-less) refreshes, mirroring the leg-merge truth
-- table. Same signatures: OR REPLACE keeps every existing call on
-- the new bodies.

CREATE OR REPLACE FUNCTION public.open_paystack_refund_recovery_watch_v1(
  p_paystack_ref text,
  p_provider_refund_id bigint,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text;
  v_matches jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_reference := nullif(btrim(coalesce(p_paystack_ref, '')), '');
  IF v_reference IS NULL OR p_provider_refund_id IS NULL
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'invalid_refund_recovery_watch' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_reference, 0)
  );

  BEGIN
    INSERT INTO public.paystack_refund_recovery_watch (
      paystack_ref, provider_refund_id, evidence
    ) VALUES (v_reference, p_provider_refund_id, p_evidence);
  EXCEPTION WHEN unique_violation THEN
    -- A prior scan (or redelivery) already watches this refund:
    -- refresh the evidence and re-scan under the lock. The refresh
    -- is verdict-sticky: a delayed failed observation must not
    -- overwrite an earlier processed one, or the claim would file
    -- failed-only evidence and audit blocking would unblock a leg a
    -- processed refund was observed for. Mirrors the leg-merge
    -- truth table (trimmed, case-insensitive failed spelling).
    UPDATE public.paystack_refund_recovery_watch
      SET evidence = CASE
        WHEN evidence->>'provider_refund_status' IS NOT NULL
          AND lower(btrim(evidence->>'provider_refund_status')) <> 'failed'
          AND (
            p_evidence->>'provider_refund_status' IS NULL
            OR lower(btrim(p_evidence->>'provider_refund_status')) = 'failed'
          )
        THEN evidence ELSE p_evidence END,
        updated_at = now()
      WHERE paystack_ref = v_reference
        AND provider_refund_id = p_provider_refund_id
        AND status = 'open';
  END;

  -- Mirrors fetchCompletedPaymentsByReference: every completed
  -- Paystack payment for the reference, in stable id order.
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'), '[]'::jsonb)
    INTO v_matches
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'order_id', t.order_id,
        'merchant_id', t.merchant_id,
        'gateway_reference', t.gateway_reference,
        'amount', t.amount
      ) AS row
      FROM public.transactions AS t
      WHERE t.gateway = 'paystack'
        AND t.gateway_reference = v_reference
        AND t.transaction_type = 'payment'
        AND t.status = 'completed'
    ) AS matches;
  RETURN v_matches;
END;
$$;
REVOKE ALL ON FUNCTION public.open_paystack_refund_recovery_watch_v1(text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_refund_recovery_watch_v1(text,bigint,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.open_paystack_refund_reference_watch_v1(
  p_paystack_ref text,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text;
  v_matches jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_reference := nullif(btrim(coalesce(p_paystack_ref, '')), '');
  IF v_reference IS NULL
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'invalid_refund_recovery_watch' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_reference, 0)
  );

  BEGIN
    INSERT INTO public.paystack_refund_recovery_watch (
      paystack_ref, provider_refund_id, evidence
    ) VALUES (v_reference, NULL, p_evidence);
  EXCEPTION WHEN unique_violation THEN
    -- A prior scan (or redelivery) already watches this reference:
    -- refresh the evidence and re-scan under the lock. The refresh
    -- is verdict-sticky: a delayed failed observation must not
    -- overwrite an earlier processed one, or the claim would file
    -- failed-only evidence and audit blocking would unblock a leg a
    -- processed refund was observed for. Mirrors the leg-merge
    -- truth table (trimmed, case-insensitive failed spelling).
    UPDATE public.paystack_refund_recovery_watch
      SET evidence = CASE
        WHEN evidence->>'provider_refund_status' IS NOT NULL
          AND lower(btrim(evidence->>'provider_refund_status')) <> 'failed'
          AND (
            p_evidence->>'provider_refund_status' IS NULL
            OR lower(btrim(p_evidence->>'provider_refund_status')) = 'failed'
          )
        THEN evidence ELSE p_evidence END,
        updated_at = now()
      WHERE paystack_ref = v_reference
        AND provider_refund_id IS NULL
        AND status = 'open';
  END;

  -- Same completed-payment filter the reference-only path scans,
  -- with the order join and currency the per-payment handler needs.
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'), '[]'::jsonb)
    INTO v_matches
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'order_id', t.order_id,
        'merchant_id', t.merchant_id,
        'gateway_reference', t.gateway_reference,
        'amount', t.amount,
        'currency', t.currency,
        'cancel_order', CASE WHEN t.order_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'cancelled_at', o.cancelled_at,
            'shipping_status', o.shipping_status,
            'order_number', o.order_number
          )
        END
      ) AS row
      FROM public.transactions AS t
      LEFT JOIN public.orders AS o ON o.id = t.order_id
      WHERE t.gateway = 'paystack'
        AND t.gateway_reference = v_reference
        AND t.transaction_type = 'payment'
        AND t.status = 'completed'
    ) AS matches;
  RETURN v_matches;
END;
$$;
REVOKE ALL ON FUNCTION public.open_paystack_refund_reference_watch_v1(text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_paystack_refund_reference_watch_v1(text,jsonb)
  TO service_role;
