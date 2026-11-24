-- Run with psql -X -v ON_ERROR_STOP=1 against an empty disposable database
-- as its superuser. Rollback includes the minimal schema and mock inventory.
BEGIN;
\ir fixtures/late_gateway_payment_reinstatement.sql
\ir ../20261120141000_record_order_payment_timeouts.sql
\ir ../20261120141100_reinstate_verified_late_order_payments.sql
\ir ../20261124090000_prelock_storefront_customer_identity.sql
\ir ../20261124100000_fix_authenticated_storefront_identity_confirmation.sql
\ir ../20261124103000_clear_reinstatement_guard_after_block.sql

CREATE TRIGGER prevent_cancelled_order_reopen
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_cancelled_order_reopen();

CREATE FUNCTION private.test_reinstatement_clamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('baci.test_clamp', true) = 'on' AND NEW.payment_status = 'paid' THEN
    NEW.payment_status := OLD.payment_status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_test_reinstatement_clamp
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.test_reinstatement_clamp();

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  merchant_id CONSTANT uuid := gen_random_uuid();
  product_id CONSTANT uuid := gen_random_uuid();
  test_order_id uuid;
  capture_id uuid;
  replacement_id uuid;
  provider text;
  result text;
  reinstatement_definition text;
BEGIN
  IF has_function_privilege('authenticated', 'public.reinstate_timeout_order_payment(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.reinstate_timeout_order_payment(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Reinstatement is callable from an untrusted role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.orders'::regclass
      AND t.tgname = 'lock_order_replacement_identity_before_insert'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Order creation does not share the replacement identity lock';
  END IF;
  SELECT pg_get_functiondef(
    'public.reinstate_timeout_order_payment(uuid,uuid)'::regprocedure
  ) INTO reinstatement_definition;
  IF strpos(reinstatement_definition, 'PERFORM p.id') = 0
    OR strpos(reinstatement_definition, 'PERFORM v.id') = 0
    OR strpos(reinstatement_definition, 'PERFORM p.id') >
      strpos(reinstatement_definition, 'PERFORM private.lock_order_replacement_identity')
    OR strpos(reinstatement_definition, 'PERFORM v.id') >
      strpos(reinstatement_definition, 'PERFORM private.lock_order_replacement_identity') THEN
    RAISE EXCEPTION 'Reinstatement must lock catalog rows before customer identity';
  END IF;

  -- Authenticated callers may omit p_user_id; lock their effective identity
  -- without routing the lookup through guest confirmation.
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (gen_random_uuid(), merchant_id, gen_random_uuid(), 'auth-user@example.test');
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT user_id::text FROM public.customers WHERE email = 'auth-user@example.test'), true);
  PERFORM private.lock_storefront_order_entrypoint_identity(
    merchant_id, NULL, 'auth-user@example.test', NULL
  );
  PERFORM set_config('request.jwt.claim.sub', '', true);

  INSERT INTO public.products VALUES (product_id, merchant_id);

  INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference)
  VALUES (gen_random_uuid(), gen_random_uuid(), merchant_id, 'credit_direct', 'shared-credit-direct-ref');
  BEGIN
    INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference)
    VALUES (gen_random_uuid(), gen_random_uuid(), merchant_id, 'credit_direct', 'shared-credit-direct-ref');
    RAISE EXCEPTION 'Credit Direct provider reference was reused across orders';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference)
  VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'credit_direct', 'shared-credit-direct-ref');

  FOREACH provider IN ARRAY ARRAY['credit_direct', 'klump', 'paystack', 'korapay', 'juicyway'] LOOP
    test_order_id := gen_random_uuid();
    capture_id := gen_random_uuid();
    INSERT INTO public.orders (id, merchant_id, payment_method, payment_status, notes)
    VALUES (test_order_id, merchant_id, provider,
      CASE WHEN provider IN ('credit_direct', 'klump') THEN 'bnpl_pending' ELSE 'unpaid' END,
      jsonb_build_object('creditDirectTransactionId', capture_id::text)::text);
    INSERT INTO public.order_items VALUES (test_order_id, product_id, NULL);
    INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference, gateway_response)
    VALUES (capture_id, test_order_id, merchant_id, provider, capture_id::text,
      jsonb_build_object('eventType', 'Checkout_Merchant_Payment_Completed', 'checkoutTransactionId', capture_id::text));

    PERFORM public.mark_abandoned_orders(72);
    IF (SELECT payment_status FROM public.orders WHERE id = test_order_id) IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'Cleanup failed to close % order', provider;
    END IF;

    PERFORM set_config('baci.test_clamp', 'on', true);
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked'
      OR EXISTS (SELECT 1 FROM private.inventory_test_effects e WHERE e.order_id = test_order_id)
      OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = test_order_id
        AND o.payment_status = 'cancelled' AND o.amount_paid = 0 AND o.paid_transaction_id IS NULL) THEN
      RAISE EXCEPTION 'Clamped paid transition did not roll back % reinstatement', provider;
    END IF;
    IF current_setting('baci.reinstating_order_id', true) IS DISTINCT FROM '' THEN
      RAISE EXCEPTION 'Blocked % reinstatement left its trigger bypass armed', provider;
    END IF;
    PERFORM set_config('baci.test_clamp', '', true);

    PERFORM set_config('baci.test_missing_inventory', 'on', true);
    result := public.reinstate_timeout_order_payment(test_order_id, capture_id);
    IF result IS DISTINCT FROM 'blocked'
      OR EXISTS (SELECT 1 FROM private.inventory_test_effects e WHERE e.order_id = test_order_id)
      OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = test_order_id AND payment_status = 'cancelled' AND amount_paid = 0) THEN
      RAISE EXCEPTION 'Inventory failure did not roll back % reinstatement', provider;
    END IF;
    PERFORM set_config('baci.test_missing_inventory', '', true);

    UPDATE public.orders SET customer_email = 'timeout-test@example.test' WHERE id = test_order_id;
    replacement_id := gen_random_uuid();
    INSERT INTO public.orders (id, merchant_id, customer_email, created_at, payment_status)
    VALUES (replacement_id, merchant_id, 'timeout-test@example.test', now(), 'pending');
    INSERT INTO public.order_items VALUES (replacement_id, product_id, NULL);
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Open replacement did not block % reinstatement', provider;
    END IF;
    DELETE FROM public.order_items WHERE order_id = replacement_id;
    DELETE FROM public.orders WHERE id = replacement_id;
    UPDATE public.orders SET customer_phone = '+2348000000000' WHERE id = test_order_id;
    replacement_id := gen_random_uuid();
    INSERT INTO public.orders (id, merchant_id, customer_email, customer_phone, created_at, payment_status)
    VALUES (replacement_id, merchant_id, 'different@example.test', '+2348000000000', now(), 'pending');
    INSERT INTO public.order_items VALUES (replacement_id, product_id, NULL);
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Phone-matched replacement did not block % reinstatement', provider;
    END IF;
    DELETE FROM public.order_items WHERE order_id = replacement_id;
    DELETE FROM public.orders WHERE id = replacement_id;
    UPDATE public.orders SET customer_phone = NULL WHERE id = test_order_id;
    UPDATE public.orders SET customer_email = NULL WHERE id = test_order_id;
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Missing customer identity did not block % reinstatement', provider;
    END IF;
    UPDATE public.orders SET customer_email = test_order_id::text || '@example.test' WHERE id = test_order_id;

    UPDATE public.transactions SET amount = 149 WHERE id = capture_id;
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Underpayment reinstated % order', provider;
    END IF;
    UPDATE public.transactions SET amount = 150 WHERE id = capture_id;

    UPDATE public.orders SET amount_paid = 10 WHERE id = test_order_id;
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Partially paid % order was reopened by the full-payment path', provider;
    END IF;
    UPDATE public.orders SET amount_paid = 0 WHERE id = test_order_id;

    INSERT INTO public.order_refund_events VALUES (test_order_id);
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'Refund evidence did not block % reinstatement', provider;
    END IF;
    DELETE FROM public.order_refund_events e WHERE e.order_id = test_order_id;

    PERFORM set_config('baci.test_inventory_unlimited', 'on', true);
    result := public.reinstate_timeout_order_payment(test_order_id, capture_id);
    PERFORM set_config('baci.test_inventory_unlimited', '', true);
    IF result IS DISTINCT FROM 'reinstated_inventory_reclaimed' OR NOT EXISTS (
      SELECT 1 FROM public.orders WHERE id = test_order_id
        AND payment_status = 'paid' AND shipping_status = 'processing'
        AND cancelled_at IS NULL AND paid_transaction_id = capture_id
        AND amount_paid = 150 AND paid_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Expected % order to be reinstated, got %', provider, result;
    END IF;
    IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'already_reinstated'
      OR (SELECT count(*) FROM private.inventory_test_effects e WHERE e.order_id = test_order_id) <> 1 THEN
      RAISE EXCEPTION 'Replay reprocessed % inventory', provider;
    END IF;
  END LOOP;

  -- Historical US-spelling cancellation rows with timeout provenance follow
  -- the same verified recovery path as current British-spelling rows.
  test_order_id := gen_random_uuid();
  capture_id := gen_random_uuid();
  INSERT INTO public.orders (
    id, merchant_id, payment_method, payment_status, shipping_status, cancelled_at
  ) VALUES (
    test_order_id, merchant_id, 'paystack', 'canceled', 'cancelled', now() - interval '4 days'
  );
  INSERT INTO public.order_items VALUES (test_order_id, product_id, NULL);
  INSERT INTO private.order_payment_timeouts (order_id, timed_out_at)
  VALUES (test_order_id, now() - interval '4 days');
  INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference)
  VALUES (capture_id, test_order_id, merchant_id, 'paystack', capture_id::text);
  PERFORM set_config('baci.test_inventory_unlimited', 'on', true);
  IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'reinstated_inventory_reclaimed' THEN
    RAISE EXCEPTION 'Alternate canceled spelling with timeout provenance did not recover';
  END IF;
  PERFORM set_config('baci.test_inventory_unlimited', '', true);

  -- Older Credit Direct orders used the resolution row as their timeout
  -- audit. Verify it can recover the original captured transaction.
  test_order_id := gen_random_uuid();
  capture_id := gen_random_uuid();
  INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status, cancelled_at, notes)
  VALUES (test_order_id, merchant_id, 'cancelled', 'cancelled', now() - interval '3 days',
    jsonb_build_object('creditDirectTransactionId', capture_id::text)::text);
  INSERT INTO public.order_items VALUES (test_order_id, product_id, NULL);
  INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference, gateway_response)
  VALUES (capture_id, test_order_id, merchant_id, 'credit_direct', capture_id::text,
    jsonb_build_object('eventType', 'Checkout_Merchant_Payment_Completed', 'checkoutTransactionId', capture_id::text));

  IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Legacy order reopened without matching timeout evidence';
  END IF;
  INSERT INTO public.reconciliation_review (order_id, issue_type, resolved_at, resolution_notes)
  VALUES (test_order_id, 'credit_direct_confirmation_missing',
    now() - interval '3 days' + interval '1 second',
    'Provider confirmation deadline expired; order was cancelled as abandoned.');
  IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'reinstated' THEN
    RAISE EXCEPTION 'Legacy audited Credit Direct timeout did not recover';
  END IF;

  test_order_id := gen_random_uuid();
  capture_id := gen_random_uuid();
  INSERT INTO public.orders (id, merchant_id, payment_status, payment_method)
  VALUES (test_order_id, merchant_id, 'bnpl_pending', 'klump');
  PERFORM public.mark_abandoned_orders(72);
  IF NOT EXISTS (SELECT 1 FROM private.order_payment_timeouts t WHERE t.order_id = test_order_id) THEN
    RAISE EXCEPTION 'Explicit-cancellation test has no valid timeout evidence';
  END IF;
  UPDATE public.orders SET cancelled_by = 'customer' WHERE id = test_order_id;
  INSERT INTO public.order_items VALUES (test_order_id, product_id, NULL);
  INSERT INTO public.transactions (id, order_id, merchant_id, gateway, gateway_reference)
  VALUES (capture_id, test_order_id, merchant_id, 'paystack', capture_id::text);
  IF public.reinstate_timeout_order_payment(test_order_id, capture_id) IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Explicit cancellation reopened';
  END IF;
  UPDATE public.orders SET payment_status = 'paid', shipping_status = 'processing' WHERE id = test_order_id;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = test_order_id
    AND payment_status = 'cancelled' AND shipping_status = 'cancelled') THEN
    RAISE EXCEPTION 'Ordinary update bypassed cancellation fence';
  END IF;
END;
$$;
ROLLBACK;
