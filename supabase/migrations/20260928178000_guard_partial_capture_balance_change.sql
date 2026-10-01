-- Compare-and-swap the outstanding balance for partial captures. The
-- non-invoice partial gate admits only an exact-balance capture, but its
-- read happens before this function's advisory lock: a concurrent
-- payment recorded between the gate and completion shrinks the
-- outstanding balance, so the exact-match capture reaches the
-- promotion branch as an overpayment — the order flips to paid with
-- amount_paid = total and no duplicate review. Callers that gated on
-- a balance pass it as p_expected_outstanding_minor; when the locked
-- balance differs the function returns BALANCE_CHANGED without
-- writing, leaving the transaction pending so the sweep re-gates on
-- the fresh balance. NULL (all other callers) preserves the legacy
-- behavior. DROP + CREATE: CREATE OR REPLACE cannot add a parameter,
-- and an overload would leave 4-arg calls on the old body.

DROP FUNCTION IF EXISTS public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text
);

CREATE FUNCTION public.complete_order_gateway_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_gateway_response jsonb DEFAULT NULL,
  p_actor text DEFAULT 'gateway_webhook',
  p_expected_outstanding_minor bigint DEFAULT NULL
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
  v_live_outstanding_minor bigint;
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

  SELECT t.status, t.order_id, t.merchant_id, COALESCE(t.amount, 0),
    t.gateway_reference, COALESCE(t.metadata, '{}'::jsonb)
  INTO v_txn_status, v_txn_order_id, v_txn_merchant_id, v_txn_amount,
    v_txn_reference, v_txn_metadata
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

  SELECT o.merchant_id, COALESCE(o.total, 0), COALESCE(o.amount_paid, 0),
    COALESCE(o.wallet_amount_used, 0), o.recorded_by_user_id,
    o.payment_status, o.shipping_status, o.cancelled_at, o.order_number
  INTO v_order_merchant_id, v_order_total, v_order_amount_paid,
    v_order_wallet_used, v_order_recorded_by, v_order_payment_status,
    v_order_shipping_status, v_order_cancelled_at, v_order_number
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'ORDER_NOT_FOUND');
  END IF;

  -- The gate's exact-balance comparison runs under this same lock:
  -- recompute the outstanding from the locked row and refuse to
  -- promote when it moved. No writes precede this return, so the
  -- transaction stays pending and the sweep re-gates. Replays skip
  -- the check (their money is already in; ordering was already
  -- decided), as do orders that cannot promote — cancelled rows
  -- keep the cancelled outcome, paid rows keep the already-paid
  -- outcome that files the duplicate review, refunded rows keep
  -- the skip.
  IF p_expected_outstanding_minor IS NOT NULL
    AND v_txn_status = 'pending'
    AND v_order_cancelled_at IS NULL
    AND lower(COALESCE(v_order_shipping_status, '')) NOT IN (
      'canceled', 'cancelled'
    )
    AND lower(COALESCE(v_order_payment_status, '')) NOT IN (
      'canceled', 'cancelled', 'paid', 'refunded'
    ) THEN
    v_live_outstanding_minor := greatest(
      0, round((v_order_total - v_order_amount_paid) * 100)
    )::bigint;
    IF v_live_outstanding_minor
      IS DISTINCT FROM p_expected_outstanding_minor THEN
      RETURN jsonb_build_object(
        'error_code', 'BALANCE_CHANGED',
        'expected_outstanding_minor', p_expected_outstanding_minor,
        'live_outstanding_minor', v_live_outstanding_minor,
        'transaction_status', v_txn_status
      );
    END IF;
  END IF;

  IF v_txn_metadata ->> 'merchant_invoice_partial_applied' = 'true'
    AND v_txn_metadata ->> 'wedge_sweep_resolution'
      = 'merchant_invoice_partial_recorded' THEN
    RETURN jsonb_build_object(
      'actor', p_actor, 'already_completed', true,
      'cancelled_at', v_order_cancelled_at,
      'merchant_invoice_partial_recorded', true,
      'order_already_paid', false, 'order_cancelled', false,
      'order_number', v_order_number, 'order_skipped_status', NULL,
      'order_updated', false, 'payment_status', v_order_payment_status,
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
      'actor', p_actor, 'already_completed', v_txn_status = 'completed',
      'cancelled_at', v_order_cancelled_at,
      'order_already_paid', false, 'order_cancelled', true,
      'order_number', v_order_number, 'order_skipped_status', NULL,
      'order_updated', false, 'payment_status', v_order_payment_status,
      'previous_payment_status', v_order_payment_status,
      'previous_shipping_status', v_order_shipping_status,
      'shipping_status', v_order_shipping_status,
      'transaction_status', CASE WHEN v_txn_status = 'pending'
        THEN 'completed' ELSE v_txn_status END
    );
  END IF;

  IF v_txn_metadata ->> 'merchant_invoice_partial_applied'
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
      AND t.id <> p_transaction_id
      AND (
        t.metadata ->> 'order_payment_allocation'
          IS DISTINCT FROM 'merchant_invoice_partial'
        OR t.metadata ->> 'merchant_invoice_partial_applied' = 'true'
      );

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
        issue_type, txn_id, paystack_ref, order_id, reason, candidates, metadata
      ) VALUES (
        'merchant_invoice_partial_payment_conflict', p_transaction_id,
        v_txn_reference, p_order_id,
        'Marked merchant invoice payment no longer matches the locked remaining balance',
        NULL,
        jsonb_build_object(
          'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
          'payment_amount', v_txn_amount,
          'remaining_balance', v_remaining_before
        )
      ) ON CONFLICT DO NOTHING;

      UPDATE public.transactions AS t
      SET
        status = 'completed',
        gateway_response = COALESCE(p_gateway_response, t.gateway_response),
        metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
          'merchant_invoice_partial_reviewed', true,
          'merchant_invoice_partial_reviewed_at', now(),
          'merchant_invoice_partial_actor', COALESCE(
            NULLIF(trim(p_actor), ''), 'gateway_webhook'
          ),
          'wedge_sweep_resolution', 'merchant_invoice_partial_conflict_reviewed'
        ),
        updated_at = now()
      WHERE t.id = p_transaction_id;

      RETURN jsonb_build_object(
        'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
        'remaining_balance', v_remaining_before,
        'transaction_status', 'completed'
      );
    END IF;
  END IF;

  SELECT public.complete_order_gateway_payment_v1(
    p_transaction_id, p_order_id, p_gateway_response, p_actor
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
            NULLIF(trim(p_actor), ''), 'gateway_webhook'
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
  uuid, uuid, jsonb, text, bigint
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text, bigint
) TO service_role;

COMMENT ON FUNCTION public.complete_order_gateway_payment(
  uuid, uuid, jsonb, text, bigint
) IS
  'Serializes marked merchant-invoice exact claims on applied funds, retires reviewed balance conflicts, and refuses to promote a gated partial capture whose locked outstanding balance moved (BALANCE_CHANGED).';
