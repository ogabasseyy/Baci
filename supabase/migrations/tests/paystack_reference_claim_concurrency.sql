-- REGRESSION TEST: Paystack reference claims are serialized across paths.
--
-- This test uses two independent PostgreSQL sessions. Run it after applying
-- all migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v DATABASE_URL="$DATABASE_URL" \
--     -f supabase/migrations/tests/paystack_reference_claim_concurrency.sql
--
-- The manual reconciliation RPC and create_payment_transaction race for the
-- same provider reference but different orders. Exactly one transaction can
-- claim the reference; the other path must fail with its reuse guard.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT dblink_connect('paystack_manual_claim', :'DATABASE_URL');
SELECT dblink_connect('paystack_gateway_claim', :'DATABASE_URL');

DO $$
DECLARE
  v_user_id uuid := '00000000-0000-4000-8000-00000000f101';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000f102';
  v_review_id uuid := '00000000-0000-4000-8000-00000000f103';
  v_manual_order_id uuid := '00000000-0000-4000-8000-00000000f104';
  v_gateway_order_id uuid := '00000000-0000-4000-8000-00000000f105';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'paystack-claim-test@example.com', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id, v_user_id, 'paystack-claim-merchant@example.com',
    'Paystack Claim Test', 'paystack-claim-test'
  );

  INSERT INTO public.orders (
    id, merchant_id, order_number, customer_name, customer_email,
    payment_status, subtotal, total, currency, source, recorded_by_user_id
  ) VALUES
    (
      v_manual_order_id, v_merchant_id, 'ORD-PAYSTACK-CLAIM-MANUAL',
      'Paystack Claim Customer', 'paystack-claim-customer@example.com',
      'unpaid', 1000, 1000, 'NGN', 'manual', v_user_id
    ),
    (
      v_gateway_order_id, v_merchant_id, 'ORD-PAYSTACK-CLAIM-GATEWAY',
      'Paystack Claim Customer', 'paystack-claim-customer@example.com',
      'unpaid', 1000, 1000, 'NGN', 'manual', v_user_id
    );

  INSERT INTO public.reconciliation_review (
    id, issue_type, paystack_ref, order_id, reason, candidates
  ) VALUES (
    v_review_id, 'payment_match_zero_candidates',
    'paystack-concurrency-reference', v_manual_order_id,
    'Concurrency regression fixture', '[]'::jsonb
  );
END;
$$;

SELECT dblink_exec(
  'paystack_manual_claim',
  $$SET request.jwt.claim.role = 'service_role'$$
);
SELECT dblink_exec(
  'paystack_gateway_claim',
  $$SET request.jwt.claim.role = 'service_role'$$
);

SELECT dblink_exec('paystack_manual_claim', 'BEGIN');
SELECT dblink_exec('paystack_gateway_claim', 'BEGIN');

-- Convert expected claim conflicts into text results inside helper functions so
-- both dblink sessions can reach COMMIT while the harness asserts the loser.
CREATE OR REPLACE FUNCTION public.try_paystack_manual_claim(
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
  p_actor text
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_message text;
BEGIN
  PERFORM public.reconcile_paystack_unmatched_partial_payment(
    p_review_id, p_order_id, p_merchant_id, p_paystack_reference, p_amount,
    p_currency, p_customer_email, p_customer_name, p_gateway_fee,
    p_platform_fee, p_merchant_amount, p_gateway_response,
    p_operator_user_id, p_actor
  );
  RETURN 'succeeded';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  IF SQLSTATE <> 'P0001'
     OR v_message <> 'paystack_reference_already_recorded' THEN
    RAISE;
  END IF;
  RETURN v_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.try_paystack_gateway_claim(
  p_merchant_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_currency text,
  p_gateway text,
  p_reference text,
  p_platform_fee numeric,
  p_merchant_amount numeric,
  p_customer_email text,
  p_customer_name text,
  p_session_id text,
  p_metadata jsonb
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_message text;
BEGIN
  PERFORM public.create_payment_transaction(
    p_merchant_id, p_order_id, p_amount, p_currency, p_gateway, p_reference,
    p_platform_fee, p_merchant_amount, p_customer_email, p_customer_name,
    p_session_id, p_metadata
  );
  RETURN 'succeeded';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  IF SQLSTATE <> 'P0001'
     OR v_message <> 'reference_in_use' THEN
    RAISE;
  END IF;
  RETURN v_message;
END;
$$;

SELECT dblink_send_query(
  'paystack_manual_claim',
  $$SELECT public.try_paystack_manual_claim(
      '00000000-0000-4000-8000-00000000f103'::uuid,
      '00000000-0000-4000-8000-00000000f104'::uuid,
      '00000000-0000-4000-8000-00000000f102'::uuid,
      'paystack-concurrency-reference', 100::numeric, 'NGN',
      'paystack-claim-customer@example.com', 'Paystack Claim Customer',
      0::numeric, 0::numeric, 100::numeric, '{}'::jsonb,
      '00000000-0000-4000-8000-00000000f101'::uuid, 'concurrency_test'
    )$$
);

SELECT dblink_send_query(
  'paystack_gateway_claim',
  $$SELECT public.try_paystack_gateway_claim(
      '00000000-0000-4000-8000-00000000f102'::uuid,
      '00000000-0000-4000-8000-00000000f105'::uuid,
      100::numeric, 'NGN', 'paystack',
      'paystack-concurrency-reference', 0::numeric, 100::numeric,
      'paystack-claim-customer@example.com', 'Paystack Claim Customer',
      NULL, '{}'::jsonb
    )$$
);

DO $$
DECLARE
  v_manual_done boolean := false;
  v_gateway_done boolean := false;
  v_manual_result text;
  v_gateway_result text;
  v_result text;
  v_attempts integer := 0;
BEGIN
  WHILE NOT (v_manual_done AND v_gateway_done) LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 200 THEN
      RAISE EXCEPTION 'Paystack reference claim concurrency test timed out';
    END IF;

    IF NOT v_manual_done
       AND dblink_is_busy('paystack_manual_claim') = 0 THEN
      BEGIN
        SELECT result.value INTO v_result
          FROM dblink_get_result('paystack_manual_claim') AS result(value text);
        PERFORM * FROM dblink_get_result('paystack_manual_claim') AS result(value text);
        v_manual_result := v_result;
      EXCEPTION WHEN OTHERS THEN
        PERFORM dblink_exec('paystack_manual_claim', 'ROLLBACK');
      END;
      IF v_manual_result = 'succeeded' THEN
        PERFORM dblink_exec('paystack_manual_claim', 'COMMIT');
      END IF;
      v_manual_done := true;
    END IF;

    IF NOT v_gateway_done
       AND dblink_is_busy('paystack_gateway_claim') = 0 THEN
      BEGIN
        SELECT result.value INTO v_result
          FROM dblink_get_result('paystack_gateway_claim') AS result(value text);
        PERFORM * FROM dblink_get_result('paystack_gateway_claim') AS result(value text);
        v_gateway_result := v_result;
      EXCEPTION WHEN OTHERS THEN
        PERFORM dblink_exec('paystack_gateway_claim', 'ROLLBACK');
      END;
      IF v_gateway_result = 'succeeded' THEN
        PERFORM dblink_exec('paystack_gateway_claim', 'COMMIT');
      END IF;
      v_gateway_done := true;
    END IF;

    IF NOT (v_manual_done AND v_gateway_done) THEN
      PERFORM pg_sleep(0.05);
    END IF;
  END LOOP;

  IF NOT (
    (v_manual_result = 'succeeded'
      AND v_gateway_result = 'reference_in_use')
    OR (v_gateway_result = 'succeeded'
      AND v_manual_result = 'paystack_reference_already_recorded')
  ) THEN
    RAISE EXCEPTION
      'expected one Paystack claim success and one expected conflict (manual=%, gateway=%)',
      v_manual_result, v_gateway_result;
  END IF;
END;
$$;

SELECT dblink_disconnect('paystack_manual_claim');
SELECT dblink_disconnect('paystack_gateway_claim');

DO $$
DECLARE
  v_transaction_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_transaction_ids
  FROM public.transactions
  WHERE gateway_reference = 'paystack-concurrency-reference';

  DELETE FROM public.merchant_settlements
   WHERE gateway_reference = 'paystack-concurrency-reference';
  DELETE FROM public.audit_logs
   WHERE resource_id = ANY (SELECT unnest(v_transaction_ids)::text);
  DELETE FROM public.transactions
   WHERE gateway_reference = 'paystack-concurrency-reference';
  DELETE FROM public.reconciliation_review
   WHERE id = '00000000-0000-4000-8000-00000000f103';
  DELETE FROM public.orders
   WHERE id IN (
     '00000000-0000-4000-8000-00000000f104',
     '00000000-0000-4000-8000-00000000f105'
   );
  DELETE FROM public.merchants
   WHERE id = '00000000-0000-4000-8000-00000000f102';
  DELETE FROM auth.users
   WHERE id = '00000000-0000-4000-8000-00000000f101';
END;
$$;
