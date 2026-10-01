-- Append-only repair for 20260811140000. The earlier 20260811120000
-- migration was recorded under the other historical collision name, so its
-- 15-argument implementation was not present when this wrapper migration ran.

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
  v_review_issue_type text;
  v_review_reference text;
  v_review_resolved_at timestamptz;
  v_review_customer_email text;
  v_order_merchant_id uuid;
  v_order_email text;
  v_result jsonb;
  v_transaction_id uuid;
  v_actor text := COALESCE(NULLIF(trim(p_actor), ''), 'manual_reconcile_paystack_partial');
  v_override_actor text := 'script:reconcile-paystack-unmatched-partial:email-mismatch-override';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: reconcile_paystack_unmatched_partial_payment requires service_role';
  END IF;

  IF NOT COALESCE(p_allow_email_mismatch, false) THEN
    RETURN public.reconcile_paystack_unmatched_partial_payment(
      p_review_id, p_order_id, p_merchant_id, p_paystack_reference,
      p_amount, p_currency, p_customer_email, p_customer_name,
      p_gateway_fee, p_platform_fee, p_merchant_amount, p_gateway_response,
      p_operator_user_id, p_actor
    );
  END IF;

  IF v_actor <> v_override_actor THEN
    RAISE EXCEPTION 'email_mismatch_override_requires_explicit_operator_actor';
  END IF;
  IF NULLIF(trim(COALESCE(p_customer_email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'email_mismatch_override_requires_provider_email';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(trim(p_paystack_reference), 0)
  );

  SELECT rr.issue_type, rr.paystack_ref, rr.resolved_at,
         rr.metadata ->> 'customer_email'
    INTO v_review_issue_type, v_review_reference, v_review_resolved_at,
         v_review_customer_email
    FROM public.reconciliation_review AS rr
   WHERE rr.id = p_review_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_review_not_found';
  END IF;
  IF v_review_issue_type <> 'payment_match_zero_candidates'
     OR v_review_reference IS DISTINCT FROM trim(p_paystack_reference)
     OR v_review_resolved_at IS NOT NULL
     OR lower(trim(COALESCE(v_review_customer_email, ''))) <>
        lower(trim(p_customer_email)) THEN
    RAISE EXCEPTION 'email_mismatch_review_evidence_missing';
  END IF;

  SELECT o.merchant_id, o.customer_email
    INTO v_order_merchant_id, v_order_email
    FROM public.orders AS o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR v_order_merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'order_not_eligible_for_manual_partial_reconciliation';
  END IF;

  IF lower(trim(COALESCE(v_order_email, ''))) = lower(trim(p_customer_email)) THEN
    RETURN public.reconcile_paystack_unmatched_partial_payment(
      p_review_id, p_order_id, p_merchant_id, p_paystack_reference,
      p_amount, p_currency, p_customer_email, p_customer_name,
      p_gateway_fee, p_platform_fee, p_merchant_amount, p_gateway_response,
      p_operator_user_id, p_actor
    );
  END IF;

  v_result := public.reconcile_paystack_unmatched_partial_payment(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference,
    p_amount, p_currency, v_order_email, p_customer_name,
    p_gateway_fee, p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor
  );
  v_transaction_id := NULLIF(v_result ->> 'transaction_id', '')::uuid;

  UPDATE public.transactions
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
       'customer_email', p_customer_email,
       'order_customer_email', v_order_email,
       'email_mismatch_override', true
     )
   WHERE id = v_transaction_id AND order_id = p_order_id;

  UPDATE public.reconciliation_review
     SET resolution_notes = COALESCE(resolution_notes, '') ||
       ' Approved provider/order email mismatch override; provider_email=' ||
       p_customer_email || ', order_email=' || COALESCE(v_order_email, '<empty>') || '.',
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'email_mismatch_override', true,
           'provider_customer_email', p_customer_email,
           'canonical_order_email', v_order_email,
           'override_actor', v_actor
         )
   WHERE id = p_review_id;

  INSERT INTO public.audit_logs (action, resource_type, resource_id, changes, status, user_id)
  VALUES (
    'manual_paystack_email_mismatch_override', 'transaction', v_transaction_id::text,
    jsonb_build_object(
      'review_id', p_review_id, 'order_id', p_order_id,
      'paystack_reference', trim(p_paystack_reference),
      'provider_customer_email', p_customer_email,
      'canonical_order_email', v_order_email
    ), 'success', p_operator_user_id
  );

  RETURN v_result || jsonb_build_object('email_mismatch_override', true);
END;
$$;

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

-- Keep the original wrapper migration byte-for-byte in the append-only repair.
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
