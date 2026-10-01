DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.reconcile_paystack_unmatched_partial_payment_v1(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.reconcile_paystack_unmatched_partial_payment(
      uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric,
      numeric, jsonb, uuid, text
    ) RENAME TO reconcile_paystack_unmatched_partial_payment_v1;
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
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;

  IF NULLIF(trim(COALESCE(p_paystack_reference, '')), '') IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(trim(p_paystack_reference), 0)
    );
    IF EXISTS (
      SELECT 1
        FROM public.transactions AS t
       WHERE lower(trim(COALESCE(t.gateway, ''))) = 'paystack'
         AND t.gateway_reference = trim(p_paystack_reference)
    ) THEN
      RAISE EXCEPTION 'paystack_reference_already_recorded';
    END IF;
  END IF;

  RETURN public.reconcile_paystack_unmatched_partial_payment_v1(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference, p_amount,
    p_currency, p_customer_email, p_customer_name, p_gateway_fee,
    p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v1(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v1(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text
) TO service_role;
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
       'public.reconcile_paystack_unmatched_partial_payment_v1(uuid,uuid,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,uuid,text,boolean)'
     ) IS NULL THEN
    ALTER FUNCTION public.reconcile_paystack_unmatched_partial_payment(
      uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric,
      numeric, jsonb, uuid, text, boolean
    ) RENAME TO reconcile_paystack_unmatched_partial_payment_v1;
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
  v_result jsonb;
  v_transaction_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;

  v_result := public.reconcile_paystack_unmatched_partial_payment_v1(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference, p_amount,
    p_currency, p_customer_email, p_customer_name, p_gateway_fee,
    p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor, p_allow_email_mismatch
  );
  v_transaction_id := NULLIF(v_result ->> 'transaction_id', '')::uuid;
  IF v_transaction_id IS NULL THEN
    RAISE EXCEPTION 'email_mismatch_override_missing_transaction_id';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v1(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment_v1(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_paystack_unmatched_partial_payment(
  uuid, uuid, uuid, text, numeric, text, text, text, numeric, numeric, numeric,
  jsonb, uuid, text, boolean
) TO service_role;

COMMENT ON COLUMN public.orders.chat_order_id IS
  'Durable link to the originating chat order for idempotent chat conversion retries.';
