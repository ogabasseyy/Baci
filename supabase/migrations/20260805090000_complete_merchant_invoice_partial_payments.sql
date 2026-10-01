-- Record verified Paystack underpayments against merchant-created invoices
-- without advancing fulfillment or pretending the invoice is fully paid.

ALTER TABLE public.reconciliation_review
  DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check;

ALTER TABLE public.reconciliation_review
  ADD CONSTRAINT reconciliation_review_issue_type_check CHECK (issue_type IN (
    'payment_match_ambiguous',
    'payment_match_zero_candidates',
    'manage_stock_cancellation_held',
    'tax_basis_unclassified',
    'tax_basis_inconsistent_total',
    'wallet_dva_order_alias_conflict',
    'customer_savings_auto_debit_allocation_failed',
    'wallet_order_funding_ambiguous',
    'wallet_order_funding_conflict',
    'wallet_order_funding_finalize_failed',
    'payment_received_after_cancellation',
    'payment_received_after_refund',
    'serialized_inventory_confirmation_failed',
    'merchant_settlement_failed',
    'gateway_payment_wedge_requires_review',
    'credit_direct_confirmation_missing',
    'order_cancellation_refund_requires_review',
    'paypal_capture_persist_failed',
    'merchant_invoice_partial_payment_conflict'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

-- A partial-payment conflict describes one captured transfer. Keep order_id
-- for navigation while deduplicating independently by txn/ref, like the other
-- captured-payment review types.
DROP INDEX IF EXISTS public.reconciliation_review_open_by_order_idx;

CREATE UNIQUE INDEX reconciliation_review_open_by_order_idx
  ON public.reconciliation_review (issue_type, order_id)
  WHERE resolved_at IS NULL
    AND order_id IS NOT NULL
    AND issue_type NOT IN (
      'payment_received_after_cancellation',
      'payment_received_after_refund',
      'merchant_settlement_failed',
      'gateway_payment_wedge_requires_review',
      'merchant_invoice_partial_payment_conflict'
    );

CREATE OR REPLACE FUNCTION public.complete_merchant_invoice_partial_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_settlement_reference text,
  p_verified_gateway_fee numeric,
  p_payment_platform_fee numeric,
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
  v_txn_amount numeric;
  v_txn_gateway text;
  v_txn_type text;
  v_txn_metadata jsonb;
  v_order_merchant_id uuid;
  v_order_total numeric := 0;
  v_order_amount_paid numeric := 0;
  v_order_wallet_used numeric := 0;
  v_order_payment_status text;
  v_order_shipping_status text;
  v_order_cancelled_at timestamptz;
  v_order_recorded_by uuid;
  v_order_number text;
  v_completed_transaction_paid numeric := 0;
  v_completed_wallet_paid numeric := 0;
  v_ledger_paid numeric := 0;
  v_paid_before numeric := 0;
  v_remaining_before numeric := 0;
  v_new_paid numeric := 0;
  v_balance_due numeric := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: complete_merchant_invoice_partial_payment requires service_role';
  END IF;

  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'INVALID_ARGUMENTS'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT
    t.status,
    t.order_id,
    t.merchant_id,
    t.amount,
    t.gateway,
    t.transaction_type,
    COALESCE(t.metadata, '{}'::jsonb)
  INTO
    v_txn_status,
    v_txn_order_id,
    v_txn_merchant_id,
    v_txn_amount,
    v_txn_gateway,
    v_txn_type,
    v_txn_metadata
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'TRANSACTION_NOT_FOUND'
    );
  END IF;

  SELECT
    o.merchant_id,
    COALESCE(o.total, 0),
    COALESCE(o.amount_paid, 0),
    COALESCE(o.wallet_amount_used, 0),
    o.payment_status,
    o.shipping_status,
    o.cancelled_at,
    o.recorded_by_user_id,
    o.order_number
  INTO
    v_order_merchant_id,
    v_order_total,
    v_order_amount_paid,
    v_order_wallet_used,
    v_order_payment_status,
    v_order_shipping_status,
    v_order_cancelled_at,
    v_order_recorded_by,
    v_order_number
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'ORDER_NOT_FOUND'
    );
  END IF;

  IF v_txn_order_id IS DISTINCT FROM p_order_id
    OR v_txn_merchant_id IS DISTINCT FROM v_order_merchant_id
    OR lower(trim(COALESCE(v_txn_gateway, ''))) <> 'paystack'
    OR v_txn_type <> 'payment'
    OR v_txn_metadata ->> 'order_payment_allocation'
      IS DISTINCT FROM 'merchant_invoice_partial'
    OR v_order_recorded_by IS NULL
    OR v_txn_status NOT IN ('pending', 'completed')
    OR v_txn_amount IS NULL
    OR v_txn_amount <= 0
    OR v_txn_amount <> round(v_txn_amount, 2)
    OR NULLIF(trim(p_settlement_reference), '') IS NULL
    OR p_verified_gateway_fee IS NULL
    OR p_verified_gateway_fee < 0
    OR p_payment_platform_fee IS NULL
    OR p_payment_platform_fee < 0
    OR p_verified_gateway_fee + p_payment_platform_fee > v_txn_amount THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'PARTIAL_PAYMENT_CONTRACT_MISMATCH'
    );
  END IF;

  -- Payment state and merchant settlement commit together. A contract-valid
  -- redelivery only reads the committed result and cannot add the same
  -- transfer twice.
  IF v_txn_status = 'completed'
    AND v_txn_metadata ->> 'merchant_invoice_partial_applied' = 'true' THEN
    RETURN jsonb_build_object(
      'outcome', 'partial_recorded',
      'already_completed', true,
      'amount_applied', v_txn_amount,
      'amount_paid', v_order_amount_paid,
      'balance_due', greatest(0, v_order_total - v_order_amount_paid),
      'order_number', v_order_number,
      'payment_status', v_order_payment_status,
      'shipping_status', v_order_shipping_status
    );
  END IF;

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

  v_ledger_paid := v_completed_transaction_paid
    + greatest(0, v_order_wallet_used - v_completed_wallet_paid);
  v_paid_before := greatest(v_order_amount_paid, v_ledger_paid);
  v_remaining_before := greatest(0, v_order_total - v_paid_before);

  IF v_order_cancelled_at IS NOT NULL
    OR v_order_shipping_status IN ('cancelled', 'canceled')
    OR v_order_payment_status IN ('paid', 'refunded', 'cancelled')
    OR v_remaining_before <= 0 THEN
    RETURN jsonb_build_object(
      'outcome', 'standard_completion',
      'reason', 'order_terminal'
    );
  END IF;

  IF v_order_payment_status NOT IN ('pending', 'unpaid', 'partially_paid') THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'ORDER_PAYMENT_STATUS_UNSUPPORTED',
      'remaining_balance', v_remaining_before
    );
  END IF;

  IF abs(v_txn_amount - v_remaining_before) <= 0.01 THEN
    RETURN jsonb_build_object(
      'outcome', 'standard_completion',
      'reason', 'amount_now_completes_order'
    );
  END IF;

  IF v_txn_amount > v_remaining_before THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'AMOUNT_EXCEEDS_REMAINING_BALANCE',
      'remaining_balance', v_remaining_before
    );
  END IF;

  v_new_paid := v_paid_before + v_txn_amount;
  v_balance_due := greatest(0, v_order_total - v_new_paid);

  UPDATE public.transactions AS t
  SET
    status = 'completed',
    gateway_response = COALESCE(p_gateway_response, t.gateway_response),
    metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'merchant_invoice_partial_applied', true,
      'merchant_invoice_partial_applied_at', now(),
      'merchant_invoice_partial_actor', COALESCE(NULLIF(trim(p_actor), ''), 'gateway_webhook'),
      'wedge_sweep_resolution', 'merchant_invoice_partial_recorded'
    ),
    updated_at = now()
  WHERE t.id = p_transaction_id;

  UPDATE public.orders AS o
  SET
    amount_paid = v_new_paid,
    payment_status = 'partially_paid',
    updated_at = now()
  WHERE o.id = p_order_id
    AND o.merchant_id = v_order_merchant_id
  RETURNING o.payment_status, o.shipping_status, o.order_number
  INTO v_order_payment_status, v_order_shipping_status, v_order_number;

  UPDATE public.order_payment_accounts AS account
  SET payable_amount = v_balance_due
  WHERE account.order_id = p_order_id
    AND account.provider = 'paystack';

  -- Keep the invoice transition and merchant credit in the same database
  -- transaction. record_merchant_settlement is independently idempotent on
  -- (source_type, source_id, gateway_reference), so a duplicate reference is
  -- a no-op while any error rolls back every update above.
  PERFORM public.record_merchant_settlement(
    p_merchant_id => v_order_merchant_id,
    p_source_type => 'order',
    p_source_id => p_order_id,
    p_gateway => 'paystack',
    p_gateway_reference => p_settlement_reference,
    p_gross_amount => v_txn_amount,
    p_gateway_fee => p_verified_gateway_fee,
    p_platform_fee => p_payment_platform_fee,
    p_description => 'Partial invoice payment via paystack',
    p_metadata => jsonb_build_object(
      'paystack_reference', p_settlement_reference,
      'verified_gateway_fee', p_verified_gateway_fee,
      'merchant_invoice_partial', true,
      'transaction_id', p_transaction_id
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'partial_recorded',
    'already_completed', false,
    'amount_applied', v_txn_amount,
    'amount_paid', v_new_paid,
    'balance_due', v_balance_due,
    'order_number', v_order_number,
    'payment_status', v_order_payment_status,
    'shipping_status', v_order_shipping_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) IS
  'Atomically records and settles a verified Paystack strict underpayment on a merchant-created invoice, preserves pending fulfillment, and remains idempotent across webhook redeliveries.';
