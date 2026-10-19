-- Regression check: admin order backdating works end-to-end against the
-- replayed schema with the real wrapper chain, timezone lookup, and
-- document-date trigger.
--
-- Payloads mirror production mobile edits: the replace RPC unconditionally
-- assigns `source` from the payload, so realistic payloads always carry it.
--
-- Usage:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/admin_order_date_edit_replay.sql

BEGIN;

SELECT set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'replay-actor@example.com'
);

INSERT INTO public.merchants (id, email, user_id, country)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'replay-check@example.com',
  '22222222-2222-4222-8222-222222222222',
  'NG'
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, source, transaction_date,
  shipping_status, invoice_issue_date, invoice_issue_date_generated,
  tax_point_date, tax_point_date_generated
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'REPLAY-BACKDATE-1', 5000.00, 'physical', '2024-05-01T10:00:00Z',
  'pending', '2024-05-01', false, '2024-05-01', false
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, source, transaction_date,
  shipping_status, invoice_issue_date, invoice_issue_date_generated,
  tax_point_date, tax_point_date_generated
)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'REPLAY-BACKDATE-2', 7500.00, 'online_store', '2024-05-01T10:00:00Z',
  'pending', '2024-05-01', true, '2024-05-01', true
);

INSERT INTO public.orders (
  id, merchant_id, order_number, total, subtotal, source, transaction_date,
  shipping_status, payment_status, invoice_issue_date,
  invoice_issue_date_generated, tax_point_date, tax_point_date_generated
)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'REPLAY-BACKDATE-3', 9000.00, 9000.00, 'manual', '2024-05-01T10:00:00Z',
  'shipped', 'paid', '2024-05-01', false, '2024-05-01', false
);

-- Financially identical line so the paid/fulfillment locks see a date-only
-- change on the order above.
INSERT INTO public.order_items (
  order_id, name, price, quantity, product_match_status
)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  'Replay Item', 9000.00, 1, 'custom'
);

-- Manual order: the explicit device day wins and merges into one audit event.
DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_result jsonb;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_id,
    ('{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02",'
    || '"source":"physical","items":[{"name":"Replay Item","price":5000,"quantity":1}],'
    || '"customer":{"name":"Replay T"},"shipping_fee":0,"discount_amount":0,"tax_amount":0,'
    || '"shipping_address":{"name":"Replay Ship"}}')::jsonb
  );
  IF NOT (v_result -> 'changed_fields' @>
      '["transaction_date","invoice_issue_date","tax_point_date"]'::jsonb)
  THEN RAISE EXCEPTION 'replay manual changed_fields failed'; END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_id
      AND transaction_date = '2024-01-02T10:00:00Z'
      AND invoice_issue_date = '2024-01-02'
      AND invoice_issue_date_generated = false
      AND tax_point_date = '2024-01-02'
      AND tax_point_date_generated = false)
  THEN RAISE EXCEPTION 'replay manual row failed'; END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  IF (SELECT count(*) FROM public.order_audit_events
      WHERE order_id = v_id) <> 1
  THEN RAISE EXCEPTION 'replay manual audit failed'; END IF;
END;
$$;

-- Non-manual order: generated document dates follow via the real trigger,
-- and the audit captures the trigger-rewritten values.
DO $$
DECLARE
  v_id uuid := '44444444-4444-4444-8444-444444444444';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_id,
    ('{"transaction_date":"2024-01-02T10:00:00Z","source":"online_store",'
    || '"items":[{"name":"Replay Item","price":7500,"quantity":1}],'
    || '"customer":{"name":"Replay U"},"shipping_fee":0,"discount_amount":0,"tax_amount":0,'
    || '"shipping_address":{"name":"Replay Ship"}}')::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_id
    AND invoice_issue_date = '2024-01-02'
    AND invoice_issue_date_generated = true
    AND tax_point_date = '2024-01-02'
    AND tax_point_date_generated = true)
    OR NOT EXISTS (SELECT 1 FROM public.order_audit_events
      WHERE order_id = v_id
      AND changed_fields @>
        ARRAY['transaction_date','invoice_issue_date','tax_point_date'])
  THEN RAISE EXCEPTION 'replay trigger follow failed'; END IF;
END;
$$;

-- Paid and shipped orders may be backdated: dates correct reporting periods
-- while amount edits stay locked. This pins the product decision.
DO $$
DECLARE
  v_id uuid := '55555555-5555-4555-8555-555555555555';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_id,
    ('{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02",'
    || '"source":"manual","items":[{"name":"Replay Item","price":9000,"quantity":1}],'
    || '"customer":{"name":"Replay V"},"shipping_fee":0,"discount_amount":0,"tax_amount":0,'
    || '"shipping_address":{"name":"Replay Ship"}}')::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_id
    AND transaction_date = '2024-01-02T10:00:00Z'
    AND invoice_issue_date = '2024-01-02') THEN
    RAISE EXCEPTION 'replay paid/shipped backdate blocked';
  END IF;
END;
$$;

-- Amount edits on the paid order stay locked while its dates may move.
DO $$
DECLARE
  v_id uuid := '55555555-5555-4555-8555-555555555555';
  v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_id,
      ('{"transaction_date":"2024-01-02T10:00:00Z","source":"manual",'
      || '"items":[{"name":"Replay Item","price":9001,"quantity":1}],'
      || '"customer":{"name":"Replay V"},"shipping_fee":0,"discount_amount":0,"tax_amount":0,'
      || '"shipping_address":{"name":"Replay Ship"}}')::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM LIKE '%order_financial_edit%' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'replay paid financial lock missing';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_admin_order_with_transaction_discount_metadata(uuid,jsonb)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'replay outer wrapper not callable'; END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated', 'public.update_admin_order(uuid,jsonb)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'replay date wrapper callable'; END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated', 'public.update_admin_order_without_date(uuid,jsonb)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'replay private delegate callable'; END IF;
END;
$$;

ROLLBACK;
