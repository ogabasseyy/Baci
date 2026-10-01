-- Preserve the applied retry migration byte-for-byte while correcting the
-- retry-only balance expression through a forward wrapper. PostgreSQL's
-- GREATEST is resolved as an ordinary built-in and must not use a
-- schema-qualified catalog call.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment_v4(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.reconcile_paystack_unmatched_partial_payment(
      uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric,
      numeric, jsonb, uuid, text
    ) RENAME TO reconcile_paystack_unmatched_partial_payment_v4;
  END IF;
END;
$$;

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
  v_transaction_id uuid;
  v_amount numeric;
  v_amount_paid numeric;
  v_total numeric;
  v_order_number text;
  v_payment_status text;
  v_shipping_status text;
  v_email_mismatch_override boolean;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants AS m
     WHERE m.id = p_merchant_id AND m.user_id = p_operator_user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_members AS sm
     WHERE sm.merchant_id = p_merchant_id
       AND sm.user_id = p_operator_user_id
       AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'operator_not_authorized_for_merchant';
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
  END IF;
  IF NULLIF(trim(COALESCE(p_paystack_reference, '')), '') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(trim(p_paystack_reference), 0)
    );
    SELECT t.id, t.amount, COALESCE(o.amount_paid, 0), COALESCE(o.total, 0),
           o.order_number, o.payment_status, o.shipping_status,
           (t.metadata ->> 'email_mismatch_override') = 'true'
      INTO v_transaction_id, v_amount, v_amount_paid, v_total, v_order_number,
           v_payment_status, v_shipping_status, v_email_mismatch_override
      FROM public.transactions AS t
      JOIN public.orders AS o ON o.id = t.order_id
     WHERE t.order_id = p_order_id
       AND lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
       AND t.gateway_reference = trim(p_paystack_reference)
       AND t.status = 'completed'
       AND t.metadata ->> 'reconciliation_review_id' = p_review_id::text
       AND t.metadata ->> 'merchant_invoice_partial_applied' = 'true'
     FOR UPDATE OF t, o;
    IF FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'partial_recorded', 'already_completed', true,
        'amount_applied', v_amount, 'amount_paid', v_amount_paid,
        'balance_due', GREATEST(0, v_total - v_amount_paid),
        'order_number', v_order_number, 'payment_status', v_payment_status,
        'shipping_status', v_shipping_status, 'transaction_id', v_transaction_id,
        'review_id', p_review_id, 'reconciled', true
      );
    END IF;
  END IF;

  RETURN public.reconcile_paystack_unmatched_partial_payment_v4(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference, p_amount,
    p_currency, p_customer_email, p_customer_name, p_gateway_fee,
    p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v4(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) TO service_role;

DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text,boolean)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment_v4(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text,boolean)'
     ) IS NULL THEN
    ALTER FUNCTION public.reconcile_paystack_unmatched_partial_payment(
      uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric,
      numeric, jsonb, uuid, text, boolean
    ) RENAME TO reconcile_paystack_unmatched_partial_payment_v4;
  END IF;
END;
$$;

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
  p_actor text,
  p_allow_email_mismatch boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transaction_id uuid;
  v_amount numeric;
  v_amount_paid numeric;
  v_total numeric;
  v_order_number text;
  v_payment_status text;
  v_shipping_status text;
  v_email_mismatch_override boolean;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants AS m
     WHERE m.id = p_merchant_id AND m.user_id = p_operator_user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_members AS sm
     WHERE sm.merchant_id = p_merchant_id
       AND sm.user_id = p_operator_user_id
       AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'operator_not_authorized_for_merchant';
  END IF;

  IF p_order_id IS NOT NULL
     AND p_allow_email_mismatch
     AND NULLIF(trim(COALESCE(p_paystack_reference, '')), '') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(trim(p_paystack_reference), 0)
    );
    SELECT t.id, t.amount, COALESCE(o.amount_paid, 0), COALESCE(o.total, 0),
           o.order_number, o.payment_status, o.shipping_status,
           (t.metadata ->> 'email_mismatch_override') = 'true'
      INTO v_transaction_id, v_amount, v_amount_paid, v_total, v_order_number,
           v_payment_status, v_shipping_status, v_email_mismatch_override
      FROM public.transactions AS t
      JOIN public.orders AS o ON o.id = t.order_id
     WHERE t.order_id = p_order_id
       AND lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
       AND t.gateway_reference = trim(p_paystack_reference)
       AND t.status = 'completed'
       AND t.metadata ->> 'reconciliation_review_id' = p_review_id::text
       AND t.metadata ->> 'merchant_invoice_partial_applied' = 'true'
       AND (
         t.metadata ->> 'email_mismatch_override' = 'true'
         OR t.metadata ->> 'email_mismatch_override' IS NULL
       )
     FOR UPDATE OF t, o;
    IF FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'partial_recorded', 'already_completed', true,
        'amount_applied', v_amount, 'amount_paid', v_amount_paid,
        'balance_due', GREATEST(0, v_total - v_amount_paid),
        'order_number', v_order_number, 'payment_status', v_payment_status,
        'shipping_status', v_shipping_status, 'transaction_id', v_transaction_id,
        'review_id', p_review_id, 'reconciled', true,
        'email_mismatch_override', v_email_mismatch_override
      );
    END IF;
  END IF;

  RETURN public.reconcile_paystack_unmatched_partial_payment_v4(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference, p_amount,
    p_currency, p_customer_email, p_customer_name, p_gateway_fee,
    p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor, p_allow_email_mismatch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v4(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) TO service_role;
