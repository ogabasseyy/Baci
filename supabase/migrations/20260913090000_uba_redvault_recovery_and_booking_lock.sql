ALTER TABLE private.uba_redvault_refunds
  DROP CONSTRAINT IF EXISTS uba_redvault_refunds_state_check;
ALTER TABLE private.uba_redvault_refunds
  ADD CONSTRAINT uba_redvault_refunds_state_check
  CHECK (state IN ('pending', 'processing', 'needs_reconciliation', 'failed', 'processed'));

CREATE OR REPLACE FUNCTION public.mark_uba_redvault_refund_submission_indeterminate(
  p_refund_id uuid
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund recovery requires service_role';
  END IF;
  SELECT * INTO v_refund
  FROM private.uba_redvault_refunds
  WHERE id = p_refund_id
  FOR UPDATE;
  IF NOT FOUND OR v_refund.state <> 'processing' THEN
    RAISE EXCEPTION 'redvault_refund_not_processing';
  END IF;
  UPDATE private.uba_redvault_refunds
  SET state = 'needs_reconciliation',
      failure_code = 'provider_submission_indeterminate',
      updated_at = pg_catalog.now()
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;
  RETURN QUERY
  SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt
  WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.mark_uba_redvault_refund_submission_indeterminate(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_uba_redvault_refund_submission_indeterminate(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_uba_redvault_refund_submission_indeterminate(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_uba_redvault_refund_submission(
  p_refund_id uuid,
  p_provider_reference text,
  p_provider_status text
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund recovery requires service_role';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_provider_reference), '') IS NULL
    OR p_provider_status NOT IN ('pending', 'processing', 'needs-attention', 'failed', 'processed') THEN
    RAISE EXCEPTION 'redvault_refund_provider_submission_invalid';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds
  WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.state <> 'needs_reconciliation' THEN
    RAISE EXCEPTION 'redvault_refund_recovery_not_pending';
  END IF;
  UPDATE private.uba_redvault_refunds
  SET state = 'processing', provider_reference = pg_catalog.btrim(p_provider_reference),
      provider_status = p_provider_status, failure_code = NULL, updated_at = pg_catalog.now()
  WHERE id = p_refund_id RETURNING * INTO v_refund;
  RETURN QUERY
  SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt
  WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_submission(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_submission(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_submission(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND NEW.payment_method = 'uba_redvault'
    AND NEW.payment_status = 'paid'
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND lower(COALESCE(NEW.shipping_status, '')) IN ('pending', 'processing', 'fulfilled', 'shipped', 'out_for_delivery', 'delivered', 'completed')
    AND (to_jsonb(NEW) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ])
    AND private.redvault_approved_completion_durable(NEW.id) THEN
    RETURN NEW;
  END IF;
  IF (NEW.payment_method = 'uba_redvault' OR (TG_OP = 'UPDATE' AND OLD.payment_method = 'uba_redvault'))
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current()) THEN
    RAISE EXCEPTION 'redvault_order_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_unscoped_redvault_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unscoped_redvault_order() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(
  p_attempt_id uuid,
  p_state text,
  p_authorization_url text DEFAULT NULL
)
RETURNS TABLE (attempt_id uuid, reference text, state text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT initialization recovery requires service_role';
  END IF;
  IF p_state NOT IN ('initialized', 'indeterminate', 'void') THEN
    RAISE EXCEPTION 'redvault_attempt_recovery_state_invalid';
  END IF;
  IF p_state = 'initialized' AND (p_authorization_url IS NULL OR p_authorization_url !~ '^https://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'redvault_attempt_url_invalid';
  END IF;
  IF p_state <> 'initialized' AND p_authorization_url IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_attempt_url_invalid';
  END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.state NOT IN ('initializing', 'indeterminate') THEN
    RAISE EXCEPTION 'redvault_attempt_not_recoverable';
  END IF;
  UPDATE private.uba_redvault_payment_attempts
  SET state = p_state,
      authorization_url = CASE WHEN p_state = 'initialized' THEN p_authorization_url ELSE NULL END,
      initialized_at = CASE WHEN p_state = 'initialized' THEN pg_catalog.now() ELSE initialized_at END
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;
  RETURN QUERY SELECT v_attempt.id, v_attempt.reference, v_attempt.state, v_attempt.authorization_url;
END;
$$;
ALTER FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text)
  TO service_role;
