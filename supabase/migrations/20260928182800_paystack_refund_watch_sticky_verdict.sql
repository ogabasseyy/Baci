-- Make watch-evidence refreshes verdict-sticky. Both openers
-- refresh the watched evidence when a redelivery collides with the
-- open row; a delayed failed observation would overwrite an earlier
-- processed one, and the claim would then file failed-only evidence
-- that audit blocking excludes — unblocking a leg a processed refund
-- was observed for. Known non-failed verdicts now survive later
-- failed (or verdict-less) refreshes, mirroring the leg-merge truth
-- table. Same signatures: OR REPLACE keeps every existing call on
-- the new bodies. Both locked rescans normalize the gateway like
-- fetchCompletedPaymentsByReference: an exact match would miss a
-- completed legacy ` Paystack ` row, and the second-pass empty
-- branch would acknowledge the event with an open watch no
-- completion ever claims.

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
      WHERE public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
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
      WHERE public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
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

-- Retire stale redriven watches whose reference still has no
-- completed payment. Each watch retires only after a final rescan
-- under the same advisory reference lock the opener and the payment
-- completion hook take: retiring outside the lock lets a payment
-- that completed after the sweep's redrive scan lose the race, and
-- its completion hook then finds the watch already retired — the
-- acknowledged provider refund is never attached or filed. Watches
-- younger than seven days, already resolved, resolved by the redrive
-- itself, or shadowed by a completed legacy payment stay open.
CREATE OR REPLACE FUNCTION public.retire_paystack_refund_recovery_watches_v1(
  p_watch_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_watch_id uuid;
  v_reference text;
  v_created timestamptz;
  v_status text;
  v_retired integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  FOREACH v_watch_id IN ARRAY COALESCE(p_watch_ids, '{}') LOOP
    SELECT paystack_ref, created_at, status
      INTO v_reference, v_created, v_status
      FROM public.paystack_refund_recovery_watch
      WHERE id = v_watch_id;
    IF NOT FOUND OR v_status IS DISTINCT FROM 'open'
      OR v_created > now() - make_interval(days => 7) THEN
      CONTINUE;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'baci_paystack_refund_watch:' || v_reference, 0)
    );
    IF EXISTS (
      SELECT 1 FROM public.transactions AS t
      WHERE t.gateway_reference = v_reference
        AND t.transaction_type = 'payment'
        AND t.status = 'completed'
        AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
    ) THEN
      CONTINUE;
    END IF;
    UPDATE public.paystack_refund_recovery_watch
      SET status = 'retired'
      WHERE id = v_watch_id AND status = 'open';
    IF FOUND THEN
      v_retired := v_retired + 1;
    END IF;
  END LOOP;
  RETURN v_retired;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_paystack_refund_recovery_watches_v1(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_paystack_refund_recovery_watches_v1(uuid[])
  TO service_role;
