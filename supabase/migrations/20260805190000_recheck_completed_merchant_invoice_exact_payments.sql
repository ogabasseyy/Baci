-- Recheck marked exact merchant-invoice payments even after the webhook has
-- flipped the transaction, while exempting the applied transaction's retry.

CREATE OR REPLACE FUNCTION public.complete_order_gateway_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_gateway_response jsonb DEFAULT NULL,
  p_actor text DEFAULT 'gateway_webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_txn_status text;
  v_txn_order_id uuid;
  v_txn_merchant_id uuid;
  v_txn_amount numeric := 0;
  v_txn_reference text;
  v_txn_metadata jsonb;
  v_order_merchant_id uuid;
  v_order_total numeric := 0;
  v_order_amount_paid numeric := 0;
  v_order_wallet_used numeric := 0;
  v_order_recorded_by uuid;
  v_order_payment_status text;
  v_order_shipping_status text;
  v_order_cancelled_at timestamptz;
  v_order_number text;
  v_completed_transaction_paid numeric := 0;
  v_completed_wallet_paid numeric := 0;
  v_savings_paid numeric := 0;
  v_paid_before numeric := 0;
  v_remaining_before numeric := 0;
  v_completion jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: complete_order_gateway_payment requires service_role';
  END IF;

  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object('error_code', 'INVALID_ARGUMENTS');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT
    t.status,
    t.order_id,
    t.merchant_id,
    COALESCE(t.amount, 0),
    t.gateway_reference,
    COALESCE(t.metadata, '{}'::jsonb)
  INTO
    v_txn_status,
    v_txn_order_id,
    v_txn_merchant_id,
    v_txn_amount,
    v_txn_reference,
    v_txn_metadata
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'TRANSACTION_NOT_FOUND');
  END IF;
  IF v_txn_order_id IS DISTINCT FROM p_order_id THEN
    RETURN jsonb_build_object('error_code', 'ORDER_TRANSACTION_MISMATCH');
  END IF;
  IF v_txn_status NOT IN ('completed', 'pending') THEN
    RETURN jsonb_build_object(
      'error_code', 'TRANSACTION_IN_UNEXPECTED_STATE',
      'transaction_status', v_txn_status
    );
  END IF;

  SELECT
    o.merchant_id,
    COALESCE(o.total, 0),
    COALESCE(o.amount_paid, 0),
    COALESCE(o.wallet_amount_used, 0),
    o.recorded_by_user_id,
    o.payment_status,
    o.shipping_status,
    o.cancelled_at,
    o.order_number
  INTO
    v_order_merchant_id,
    v_order_total,
    v_order_amount_paid,
    v_order_wallet_used,
    v_order_recorded_by,
    v_order_payment_status,
    v_order_shipping_status,
    v_order_cancelled_at,
    v_order_number
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'ORDER_NOT_FOUND');
  END IF;

  IF v_txn_metadata ->> 'merchant_invoice_partial_applied' = 'true'
    AND v_txn_metadata ->> 'wedge_sweep_resolution'
      = 'merchant_invoice_partial_recorded' THEN
    RETURN jsonb_build_object(
      'actor', p_actor,
      'already_completed', true,
      'cancelled_at', v_order_cancelled_at,
      'merchant_invoice_partial_recorded', true,
      'order_already_paid', false,
      'order_cancelled', false,
      'order_number', v_order_number,
      'order_skipped_status', NULL,
      'order_updated', false,
      'payment_status', v_order_payment_status,
      'previous_payment_status', v_order_payment_status,
      'previous_shipping_status', v_order_shipping_status,
      'shipping_status', v_order_shipping_status,
      'transaction_status', v_txn_status
    );
  END IF;

  IF v_order_cancelled_at IS NOT NULL
    OR lower(COALESCE(v_order_shipping_status, '')) IN ('canceled', 'cancelled')
    OR lower(COALESCE(v_order_payment_status, '')) IN ('canceled', 'cancelled') THEN
    IF v_txn_status = 'pending' THEN
      UPDATE public.transactions AS t
      SET status = 'completed',
          gateway_response = COALESCE(p_gateway_response, t.gateway_response),
          updated_at = now()
      WHERE t.id = p_transaction_id;
    END IF;

    RETURN jsonb_build_object(
      'actor', p_actor,
      'already_completed', v_txn_status = 'completed',
      'cancelled_at', v_order_cancelled_at,
      'order_already_paid', false,
      'order_cancelled', true,
      'order_number', v_order_number,
      'order_skipped_status', NULL,
      'order_updated', false,
      'payment_status', v_order_payment_status,
      'previous_payment_status', v_order_payment_status,
      'previous_shipping_status', v_order_shipping_status,
      'shipping_status', v_order_shipping_status,
      'transaction_status', CASE
        WHEN v_txn_status = 'pending' THEN 'completed'
        ELSE v_txn_status
      END
    );
  END IF;

  IF v_txn_status IN ('pending', 'completed')
    AND v_txn_metadata ->> 'merchant_invoice_partial_applied'
      IS DISTINCT FROM 'true'
    AND v_txn_order_id = p_order_id
    AND v_txn_merchant_id = v_order_merchant_id
    AND v_order_recorded_by IS NOT NULL
    AND v_txn_metadata ->> 'order_payment_allocation'
      = 'merchant_invoice_partial' THEN
    SELECT
      COALESCE(sum(COALESCE(t.amount, 0)), 0)::numeric,
      COALESCE(sum(COALESCE(t.amount, 0)) FILTER (
        WHERE lower(COALESCE(t.gateway, '')) IN ('wallet', 'store_credit')
      ), 0)::numeric
    INTO v_completed_transaction_paid, v_completed_wallet_paid
    FROM public.transactions AS t
    WHERE t.order_id = p_order_id
      AND t.merchant_id = v_order_merchant_id
      AND t.transaction_type = 'payment'
      AND t.status = 'completed'
      AND t.id <> p_transaction_id;

    SELECT COALESCE(sum(COALESCE(r.amount, 0)), 0)::numeric
    INTO v_savings_paid
    FROM public.customer_savings_redemptions AS r
    WHERE r.order_id = p_order_id
      AND r.merchant_id = v_order_merchant_id
      AND r.metadata ->> 'reversed_at' IS NULL;

    v_paid_before := greatest(
      v_order_amount_paid,
      v_completed_transaction_paid
        + greatest(0, v_order_wallet_used - v_completed_wallet_paid)
        + v_savings_paid
    );
    v_remaining_before := greatest(0, v_order_total - v_paid_before);

    IF abs(v_txn_amount - v_remaining_before) > 0.01 THEN
      INSERT INTO public.reconciliation_review (
        issue_type,
        txn_id,
        paystack_ref,
        order_id,
        reason,
        candidates,
        metadata
      ) VALUES (
        'merchant_invoice_partial_payment_conflict',
        p_transaction_id,
        v_txn_reference,
        p_order_id,
        'Marked merchant invoice payment no longer matches the locked remaining balance',
        NULL,
        jsonb_build_object(
          'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
          'payment_amount', v_txn_amount,
          'remaining_balance', v_remaining_before
        )
      ) ON CONFLICT DO NOTHING;

      RETURN jsonb_build_object(
        'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
        'remaining_balance', v_remaining_before,
        'transaction_status', v_txn_status
      );
    END IF;
  END IF;

  SELECT public.complete_order_gateway_payment_v1(
    p_transaction_id,
    p_order_id,
    p_gateway_response,
    p_actor
  ) INTO v_completion;

  IF v_txn_metadata ->> 'order_payment_allocation'
      = 'merchant_invoice_partial'
    AND v_completion ->> 'error_code' IS NULL
    AND v_completion ->> 'payment_status' = 'paid' THEN
    UPDATE public.transactions AS t
    SET metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
          'merchant_invoice_partial_applied', true,
          'merchant_invoice_partial_applied_at', now(),
          'merchant_invoice_partial_actor', COALESCE(
            NULLIF(trim(p_actor), ''),
            'gateway_webhook'
          ),
          'wedge_sweep_resolution', 'merchant_invoice_exact_completed'
        ),
        updated_at = now()
    WHERE t.id = p_transaction_id;
  END IF;

  RETURN v_completion;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text
) IS
  'Rechecks pending and webhook-completed marked merchant-invoice payments under the order lock while preserving applied exact-payment retries.';
