-- Preserve accepted/indeterminate submissions when rejecting stale assessments.
-- Existing ownership, grants, and atomic wallet-refund path remain unchanged.
CREATE OR REPLACE FUNCTION public.fail_petrock_remediation_before_acceptance(
  p_order_id uuid,
  p_reason text,
  p_customer_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.petrock_orders%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));
  SELECT * INTO v_order
  FROM public.petrock_orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN RETURN false; END IF;
  IF v_order.status = 'refunded' THEN RETURN true; END IF;
  -- Refund only before submission or after a definitive provider rejection.
  -- A receipt always wins, including a race with a rejection response.
  IF v_order.provider_order_id IS NOT NULL THEN
    RETURN false;
  END IF;
  IF p_reason = 'provider_submit_rejected' THEN
    IF v_order.status NOT IN ('submitting', 'submission_unknown') THEN
      RETURN false;
    END IF;
  ELSIF v_order.status <> 'paid' OR v_order.provider_attempt_started_at IS NOT NULL
      OR NOT (NULLIF(btrim(p_reason), '') IS NULL
        OR p_reason = 'eligibility_evidence_invalid'
        OR p_reason = 'provider_preflight_failed'
        OR p_reason LIKE 'paid_recovery\_%' ESCAPE '\') THEN
    RETURN false;
  END IF;
  IF v_order.status NOT IN ('paid', 'submitting', 'submission_unknown') THEN
    RETURN false;
  END IF;

  UPDATE public.petrock_orders
  SET status = 'refund_pending',
      provider_status = p_reason,
      customer_message = p_customer_message,
      failure_reason = p_reason,
      reconcile_lease_token = NULL,
      reconcile_lease_until = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.petrock_order_events (
    order_id, event_type, from_status, to_status, metadata
  ) VALUES (
    p_order_id, 'provider_not_accepted', v_order.status, 'refund_pending',
    jsonb_build_object('reason', p_reason)
  );

  PERFORM public.refund_wallet_for_remediation(p_order_id, p_reason);
  RETURN true;
END;
$$;
