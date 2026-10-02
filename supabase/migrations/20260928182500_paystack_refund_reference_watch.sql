-- Extend the refund-recovery watch handoff to reference-only refund
-- events, which carry no provider refund ID. Without this, a payment
-- pending during the completed scan that completes before the stalled
-- scan ends both passes empty, and the signed event is acknowledged
-- with no durable trace while the order stays paid and fulfillable.
-- Reference watches (provider_refund_id NULL, one open row per
-- reference) open atomically with a confirming re-scan, the
-- completion path claims them under the same reference advisory lock,
-- and the sweep re-drives stragglers — the same handoff as ID-keyed
-- watches, keyed by reference alone.

ALTER TABLE public.paystack_refund_recovery_watch
  ALTER COLUMN provider_refund_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS paystack_refund_reference_watch_open_idx
  ON public.paystack_refund_recovery_watch (paystack_ref)
  WHERE provider_refund_id IS NULL AND status = 'open';

-- Open (or refresh) the reference watch for a signed reference-only
-- event, then return every completed local payment for its reference.
-- The insert and the confirming scan share one transaction under the
-- reference advisory lock the completion path claims under: rows
-- returned mean the payment landed first and the caller handles them;
-- an empty set leaves the watch open for the completion to claim.
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
    -- refresh the event verdict and re-scan under the lock. A
    -- non-failed verdict is sticky: a delayed failed redelivery must
    -- not overwrite an earlier processed observation, or the claim
    -- files failed-only evidence the audit reader excludes and
    -- cancellation refunds the leg again.
    UPDATE public.paystack_refund_recovery_watch
      SET evidence = p_evidence || jsonb_build_object(
        'provider_refund_status',
        CASE
          WHEN evidence->>'provider_refund_status' IS DISTINCT FROM 'failed'
            AND p_evidence->>'provider_refund_status' = 'failed'
          THEN evidence->>'provider_refund_status'
          ELSE p_evidence->>'provider_refund_status'
        END
      ),
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

-- Resolve the reference watch once the event's evidence is durably
-- handled. Returns false when no open or claimed reference watch
-- exists, so callers on paths that never opened one stay silent.
CREATE OR REPLACE FUNCTION public.resolve_paystack_refund_reference_watch_v1(
  p_paystack_ref text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Resolve only the open handoff: the open-watch unique index
  -- admits one per reference, so this is exactly the caller's watch.
  -- Claimed watches stay for future matching completions — resolving
  -- them here would leave a later legacy/corrupt payment sharing the
  -- reference with no watch to file its refund evidence.
  UPDATE public.paystack_refund_recovery_watch
    SET status = 'resolved', updated_at = now()
    WHERE paystack_ref = nullif(btrim(coalesce(p_paystack_ref, '')), '')
      AND provider_refund_id IS NULL
      AND status = 'open';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_paystack_refund_reference_watch_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_paystack_refund_reference_watch_v1(text)
  TO service_role;
