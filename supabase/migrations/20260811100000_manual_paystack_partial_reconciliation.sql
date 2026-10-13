-- Allow an operator to apply a verified Paystack payment that was filed as a
-- zero-candidate review. The original pending transaction is never rewritten:
-- this function creates a new, auditable merchant-invoice partial capture,
-- completes it through the same locked RPC as the webhook, and resolves the
-- review in the same database transaction.

CREATE OR REPLACE FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  p_review_id uuid,
  p_order_id uuid,
  p_merchant_id uuid,
  p_paystack_reference text,
  p_amount numeric,
  p_currency text,
  p_customer_email text,
  p_customer_name text,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_merchant_amount numeric,
  p_gateway_response jsonb,
  p_operator_user_id uuid,
  p_actor text DEFAULT 'manual_reconcile_paystack_partial'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_review_issue_type text;
  v_review_reference text;
  v_review_resolved_at timestamptz;
  v_order_merchant_id uuid;
  v_order_total numeric;
  v_order_amount_paid numeric;
  v_order_currency text;
  v_order_email text;
  v_order_payment_status text;
  v_order_recorded_by uuid;
  v_remaining numeric;
  v_transaction_id uuid;
  v_completion jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;
  IF p_review_id IS NULL OR p_order_id IS NULL OR p_merchant_id IS NULL
     OR p_operator_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_reconciliation_arguments';
  END IF;
  IF NULLIF(trim(COALESCE(p_paystack_reference, '')), '') IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR p_gateway_fee IS NULL OR p_gateway_fee < 0
     OR p_platform_fee IS NULL OR p_platform_fee < 0
     OR p_merchant_amount IS NULL OR p_merchant_amount < 0
     OR p_gateway_fee + p_platform_fee > p_amount
     OR p_merchant_amount > p_amount THEN
    RAISE EXCEPTION 'invalid_reconciliation_amounts';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(trim(p_paystack_reference), 0)
  );

  SELECT rr.issue_type, rr.paystack_ref, rr.resolved_at
    INTO v_review_issue_type, v_review_reference, v_review_resolved_at
    FROM public.reconciliation_review AS rr
   WHERE rr.id = p_review_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_review_not_found';
  END IF;
  IF v_review_issue_type <> 'payment_match_zero_candidates'
     OR v_review_reference IS DISTINCT FROM trim(p_paystack_reference)
     OR v_review_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'reconciliation_review_not_open';
  END IF;

  SELECT o.merchant_id, COALESCE(o.total, 0), COALESCE(o.amount_paid, 0),
         o.currency, o.payment_status, o.recorded_by_user_id, o.customer_email
    INTO v_order_merchant_id, v_order_total, v_order_amount_paid,
         v_order_currency, v_order_payment_status, v_order_recorded_by,
         v_order_email
    FROM public.orders AS o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order_merchant_id IS DISTINCT FROM p_merchant_id
     OR v_order_recorded_by IS NULL
     OR lower(trim(COALESCE(v_order_email, ''))) <> lower(trim(COALESCE(p_customer_email, '')))
     OR lower(trim(COALESCE(v_order_currency, 'NGN'))) <> lower(trim(COALESCE(p_currency, 'NGN')))
     OR v_order_payment_status NOT IN ('pending', 'unpaid', 'partially_paid') THEN
    RAISE EXCEPTION 'order_not_eligible_for_manual_partial_reconciliation';
  END IF;

  v_remaining := greatest(0, v_order_total - v_order_amount_paid);
  IF p_amount >= v_remaining THEN
    RAISE EXCEPTION 'manual_partial_amount_must_be_less_than_remaining_balance';
  END IF;

  SELECT t.id INTO v_transaction_id
    FROM public.transactions AS t
   WHERE t.gateway = 'paystack' AND t.gateway_reference = trim(p_paystack_reference)
   FOR UPDATE;
  IF v_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'paystack_reference_already_recorded';
  END IF;

  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency, status, gateway,
    gateway_reference, platform_fee, merchant_amount, description, metadata,
    gateway_response
  ) VALUES (
    p_merchant_id, p_order_id, 'payment', p_amount,
    COALESCE(NULLIF(trim(p_currency), ''), 'NGN'), 'pending', 'paystack',
    trim(p_paystack_reference), p_platform_fee, p_merchant_amount,
    'Manually reconciled Paystack invoice payment',
    jsonb_strip_nulls(jsonb_build_object(
      'order_payment_allocation', 'merchant_invoice_partial',
      'manual_reconciliation', true,
      'reconciliation_review_id', p_review_id,
      'paystack_reference', trim(p_paystack_reference),
      'reconciled_by', COALESCE(NULLIF(trim(p_actor), ''), 'manual_reconcile_paystack_partial'),
      'customer_email', p_customer_email,
      'customer_name', p_customer_name
    )),
    p_gateway_response
  ) RETURNING id INTO v_transaction_id;

  SELECT public.complete_merchant_invoice_partial_payment(
    v_transaction_id, p_order_id, trim(p_paystack_reference), p_gateway_fee,
    p_platform_fee, p_gateway_response,
    COALESCE(NULLIF(trim(p_actor), ''), 'manual_reconcile_paystack_partial')
  ) INTO v_completion;

  IF COALESCE(v_completion ->> 'outcome', '') <> 'partial_recorded' THEN
    RAISE EXCEPTION 'manual_partial_completion_failed: %', v_completion;
  END IF;

  UPDATE public.reconciliation_review
     SET resolved_at = now(), resolved_by = p_operator_user_id,
         resolution_notes = format(
           'Applied verified Paystack partial payment %s as transaction %s; amount=%s; remaining_balance=%s.',
           trim(p_paystack_reference), v_transaction_id, p_amount,
           v_completion ->> 'balance_due'
         ),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'resolution', 'manual_paystack_partial_applied',
           'applied_transaction_id', v_transaction_id,
           'verified_amount', p_amount,
           'operator_actor', COALESCE(NULLIF(trim(p_actor), ''), 'manual_reconcile_paystack_partial')
         )
   WHERE id = p_review_id AND resolved_at IS NULL;

  INSERT INTO public.audit_logs (action, resource_type, resource_id, changes, status, user_id)
  VALUES (
    'manual_paystack_partial_reconcile', 'transaction', v_transaction_id::text,
    jsonb_build_object(
      'review_id', p_review_id, 'order_id', p_order_id,
      'paystack_reference', trim(p_paystack_reference), 'amount', p_amount,
      'balance_due', v_completion -> 'balance_due'
    ), 'success', p_operator_user_id
  );

  RETURN v_completion || jsonb_build_object(
    'transaction_id', v_transaction_id, 'review_id', p_review_id,
    'reconciled', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) IS
  'Applies a verified unmatched Paystack payment as a merchant-invoice partial capture without rewriting the original transaction, resolves its zero-candidate review, and records an operator audit row.';
