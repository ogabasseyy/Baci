CREATE OR REPLACE FUNCTION private.redvault_approved_completion_durable(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.uba_redvault_applications AS application
    JOIN private.uba_redvault_payment_attempts AS attempt
      ON attempt.application_id = application.id
    WHERE application.order_id = p_order_id
      AND application.status = 'approved'
      AND attempt.state = 'approved'
      AND jsonb_typeof(attempt.provider_response->'completion_receipt') = 'object'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt') = 'object'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryConfirmed' = 'true'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt'->'inventoryReclaimedUnitCount') = 'number'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryReclaimedUnitCount' ~ '^(0|[1-9][0-9]*)$'
  );
$$;
ALTER FUNCTION private.redvault_approved_completion_durable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_approved_completion_durable(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
      'shipping_status',
      'tracking_number',
      'shipping_provider',
      'shipment_id',
      'shipped_at',
      'delivered_at',
      'fulfillment_details',
      'updated_at'
    ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
      'shipping_status',
      'tracking_number',
      'shipping_provider',
      'shipment_id',
      'shipped_at',
      'delivered_at',
      'fulfillment_details',
      'updated_at'
    ])
    AND private.redvault_approved_completion_durable(NEW.id) THEN
    RETURN NEW;
  END IF;

  IF (NEW.payment_method = 'uba_redvault' OR (TG_OP = 'UPDATE' AND OLD.payment_method = 'uba_redvault'))
    AND NOT EXISTS (
      SELECT 1
      FROM private.uba_redvault_write_context
      WHERE transaction_id = pg_catalog.txid_current()
    ) THEN
    RAISE EXCEPTION 'redvault_order_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_unscoped_redvault_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unscoped_redvault_order() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_redvault_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE order_id = v_order_id) THEN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - 'fulfillment_data') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'fulfillment_data')
      AND private.redvault_approved_completion_durable(v_order_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'redvault_order_snapshot_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
ALTER FUNCTION private.reject_redvault_item_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_redvault_item_mutation() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb)
  RENAME TO approve_and_complete_uba_redvault_payment_legacy_919;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment_legacy_919(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.approve_and_complete_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_verified_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_transaction_status text;
  v_attempt_state text;
  v_shipping_status text;
  v_cancelled_at timestamptz;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role';
  END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'redvault_verified_completion_invalid_arguments';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT status INTO v_transaction_status
  FROM public.transactions
  WHERE id = p_transaction_id AND order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR (v_transaction_status IN ('pending', 'completed')) IS NOT TRUE THEN
    RAISE EXCEPTION 'redvault_verified_completion_transaction_state_invalid';
  END IF;

  SELECT attempt.state, order_row.shipping_status, order_row.cancelled_at
  INTO v_attempt_state, v_shipping_status, v_cancelled_at
  FROM public.orders AS order_row
  LEFT JOIN private.uba_redvault_payment_attempts AS attempt
    ON attempt.order_id = order_row.id
    AND attempt.reference = (
      SELECT transaction.gateway_reference
      FROM public.transactions AS transaction
      WHERE transaction.id = p_transaction_id
    )
  WHERE order_row.id = p_order_id
  FOR UPDATE OF order_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_verified_completion_order_mismatch';
  END IF;

  IF v_cancelled_at IS NOT NULL
    OR lower(COALESCE(v_shipping_status, '')) IN ('canceled', 'cancelled') THEN
    RAISE EXCEPTION 'redvault_verified_completion_order_state_invalid';
  END IF;
  IF v_attempt_state IS DISTINCT FROM 'approved'
    AND lower(COALESCE(v_shipping_status, '')) NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'redvault_verified_completion_order_state_invalid';
  END IF;
  IF v_attempt_state = 'approved'
    AND lower(COALESCE(v_shipping_status, '')) NOT IN ('pending', 'processing', 'fulfilled', 'shipped', 'out_for_delivery', 'delivered', 'completed') THEN
    RAISE EXCEPTION 'redvault_verified_completion_order_state_invalid';
  END IF;

  RETURN public.approve_and_complete_uba_redvault_payment_legacy_919(
    p_transaction_id,
    p_order_id,
    p_verified_evidence
  );
END;
$$;
ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role;
