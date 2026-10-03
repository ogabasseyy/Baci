-- Durable handoff for verified Paystack refunds that match no local
-- payment yet. Recovery used to acknowledge after two empty SELECT
-- snapshots; a payment completing between the final scan and the
-- return left the refund with no local row or review while the order
-- stayed paid and fulfillable. The opener below inserts the watch and
-- re-scans under one reference advisory lock, and the completion path
-- claims the watch under the same lock — a concurrent completion
-- either lands before the scan or files the watch evidence, never
-- neither. The sweep re-drives watches completions outside the charge
-- RPC leave behind, and retires foreign references that never match.

CREATE TABLE IF NOT EXISTS public.paystack_refund_recovery_watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paystack_ref text NOT NULL,
  provider_refund_id bigint NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'resolved', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS paystack_refund_recovery_watch_open_idx
  ON public.paystack_refund_recovery_watch
  (paystack_ref, provider_refund_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS paystack_refund_recovery_watch_sweep_idx
  ON public.paystack_refund_recovery_watch (status, created_at);

ALTER TABLE public.paystack_refund_recovery_watch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paystack_refund_recovery_watch
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.paystack_refund_recovery_watch TO service_role;
-- Deliberately no policies — RLS-enabled-with-no-policies still denies
-- non-service callers even if grants are accidentally re-added.

-- Open (or refresh) the recovery watch for a verified refund, then
-- return every completed local payment for its reference. The insert
-- and the confirming scan share one transaction under the reference
-- advisory lock the completion path claims under, so the empty
-- handoff is atomic: rows returned mean the payment landed first and
-- the caller handles it; an empty set leaves the watch open for the
-- completion to claim.
CREATE FUNCTION public.open_paystack_refund_recovery_watch_v1(
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
    -- refresh the verified evidence and re-scan under the lock.
    UPDATE public.paystack_refund_recovery_watch
      SET evidence = p_evidence, updated_at = now()
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

-- Resolve the watch once the refund is durably handled (audit row
-- recorded or candidate evidence filed). Returns false when no open
-- or claimed watch exists, so callers on paths that never opened one
-- stay silent. A claimed watch resolves too: the completion already
-- filed its evidence.
CREATE FUNCTION public.resolve_paystack_refund_recovery_watch_v1(
  p_paystack_ref text,
  p_provider_refund_id bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.paystack_refund_recovery_watch
    SET status = 'resolved', updated_at = now()
    WHERE paystack_ref = nullif(btrim(coalesce(p_paystack_ref, '')), '')
      AND provider_refund_id = p_provider_refund_id
      AND status IN ('open', 'claimed');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_paystack_refund_recovery_watch_v1(text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_paystack_refund_recovery_watch_v1(text,bigint)
  TO service_role;
