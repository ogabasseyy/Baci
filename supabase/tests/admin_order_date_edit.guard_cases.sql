-- Validation, rollback, terminal, auth, and fallback cases. Not standalone.

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_bad jsonb;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    '{"transaction_date":"bad"}'::jsonb,
    '{"transaction_date":"2024-02-31T10:00:00Z"}'::jsonb,
    '{"transaction_date":"infinity"}'::jsonb,
    '{"transaction_date":null}'::jsonb,
    '{"transaction_date":123}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"01/02/2024"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-02-31"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-05"}'::jsonb,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":123}'::jsonb,
    '{"transaction_date_day":"2024-01-02"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, v_bad);
      RAISE EXCEPTION 'invalid date accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT LIKE '%order_date_invalid%'
        OR SQLERRM LIKE '%order_date_in_future%' THEN
        RAISE EXCEPTION 'malformed date code wrong: %', SQLERRM;
      END IF;
    END;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2999-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'future date accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%order_date_in_future%' THEN
      RAISE EXCEPTION 'future date code wrong: %', SQLERRM;
    END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_events integer;
BEGIN
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z","fail":true}');
    RAISE EXCEPTION 'underlying failure swallowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fixture_edit_failed' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_id
    AND transaction_date = '2024-01-02T10:00:00Z') THEN
    RAISE EXCEPTION 'failed edit changed date';
  END IF;
  IF (SELECT count(*) FROM order_audit_events WHERE order_id = v_id) <> v_events THEN
    RAISE EXCEPTION 'failed edit generated audit';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_events integer;
BEGIN
  UPDATE orders SET shipping_status = 'cancelled' WHERE id = v_id;
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'terminal order date edit accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM order_audit_events WHERE order_id = v_id) <> v_events THEN
    RAISE EXCEPTION 'terminal edit reached the delegate';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  PERFORM set_config('test.actor', '', false);
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, '{}'::jsonb);
    RAISE EXCEPTION 'unauthenticated edit accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;

  PERFORM set_config('test.actor', '44444444-4444-4444-8444-444444444444', false);
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
      '{"transaction_date":"2023-01-01T10:00:00Z"}');
    RAISE EXCEPTION 'unauthorized date edit accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_function_privilege('authenticated',
    'public.update_admin_order_without_date(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private delegate callable';
  END IF;
  IF has_function_privilege('authenticated',
    'public.update_admin_order(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'date wrapper callable';
  END IF;
  IF NOT has_function_privilege('authenticated',
    'public.update_admin_order_with_transaction_discount_metadata(uuid,jsonb)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'outer wrapper not callable';
  END IF;
  IF has_function_privilege('authenticated',
    'public.update_admin_order_with_transaction_discount_metadata_without_payment_lock(uuid,jsonb)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'lock inner wrapper callable';
  END IF;
END;
$$;

-- Standalone-insert fallback: when the delegate writes no audit event, the
-- date wrapper still records its own.
CREATE OR REPLACE FUNCTION public.update_admin_order_without_dva_balance_refresh(uuid, jsonb)
  RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN jsonb_build_object('order_id', $1, 'changed_fields', '[]'::jsonb,
    'change_category', 'internal');
END;
$$;
SET test.actor = '22222222-2222-4222-8222-222222222222';
DO $$
DECLARE
  v_id uuid := '88888888-8888-4888-8888-888888888888';
BEGIN
  INSERT INTO orders VALUES (
    v_id, '11111111-1111-4111-8111-111111111111',
    'online_store', '2024-05-01T10:00:00Z', '2024-05-01T10:00:00Z', NULL, 'pending',
    NULL, NULL, NULL, NULL, NULL
  );
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-06-01T10:00:00Z"}');
  IF NOT EXISTS (SELECT 1 FROM order_audit_events
    WHERE order_id = v_id
    AND changed_fields = ARRAY['transaction_date']
    AND actor_user_id = '22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'standalone fallback insert missing';
  END IF;
END;
$$;
