-- REGRESSION TEST: status response truncates history/events at 50 with flags.
--
-- The response caps the history and events tails at the newest 50 rows
-- (LIMIT-51 probe) and reports historyTruncated/eventsTruncated so the
-- timeline can say so instead of posing as the complete record. Exactly
-- 50 rows reports no truncation (the 51st row is the probe).
-- Fixtures use the 9ef7 namespace and roll back.
--
-- USAGE:
--   supabase test db supabase/tests/order_refund_response_truncation.sql

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $truncation_fixtures$
DECLARE
  v_owner_id uuid := '9ef70000-0000-4000-8000-000000000001';
  v_merchant_id uuid := '9ef70100-0000-4000-8000-000000000001';
  v_big_order_id uuid := '9ef71000-0000-4000-8000-000000000001';
  v_edge_order_id uuid := '9ef71000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'trunc-owner@example.test', 'test',
      pg_catalog.now(), pg_catalog.now(), pg_catalog.now(), '{}'::jsonb,
      '{}'::jsonb);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES
    (v_merchant_id, v_owner_id, 'trunc@example.test',
      'Truncation Fixture', 'truncation-fixture');

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, amount_paid,
    payment_status, shipping_status
  ) VALUES
    (v_big_order_id, v_merchant_id, 'TRUNC-051', 100, 100,
      'paid', 'delivered'),
    (v_edge_order_id, v_merchant_id, 'TRUNC-050', 100, 100,
      'paid', 'delivered');

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata, created_at
  )
  SELECT
    md5('trunc-refund-' || g)::uuid, v_merchant_id, v_big_order_id,
    'refund', 1, 'NGN', 'completed', 'manual', 'trunc-' || g,
    '{}'::jsonb, pg_catalog.now() + (g || ' seconds')::interval
  FROM generate_series(1, 51) g;

  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata, created_at
  )
  SELECT
    md5('edge-refund-' || g)::uuid, v_merchant_id, v_edge_order_id,
    'refund', 1, 'NGN', 'completed', 'manual', 'edge-' || g,
    '{}'::jsonb, pg_catalog.now() + (g || ' seconds')::interval
  FROM generate_series(1, 50) g;

  -- No explicit event inserts: the sync trigger audits one event
  -- per terminal refund row, so events stay 1:1 with history and the
  -- test pins the real invariant end to end.

  -- Reach the function body past the schema boundary (rolled back):
  -- the suite asserts production keeps USAGE denied. Table grants
  -- plus open probe policies isolate the truncation flags from RLS,
  -- which the confinement and grant-pin suites cover.
  GRANT USAGE ON SCHEMA private TO authenticated;
  GRANT SELECT ON public.transactions TO authenticated;
  GRANT SELECT ON public.order_refund_events TO authenticated;
  CREATE POLICY truncation_probe_transactions
    ON public.transactions FOR SELECT TO authenticated
    USING (true);
  CREATE POLICY truncation_probe_refund_events
    ON public.order_refund_events FOR SELECT TO authenticated
    USING (true);
END;
$truncation_fixtures$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9ef70000-0000-4000-8000-000000000001',
  true
);

DO $truncation_assert$
DECLARE
  v_response jsonb;
BEGIN
  SELECT private.refund_status_response(
    '9ef71000-0000-4000-8000-000000000001',
    '9ef70100-0000-4000-8000-000000000001',
    'NGN', 100, 51, 49, 0, 0, 'not_started', NULL, 0, 0,
    true, false, false, pg_catalog.now()
  ) INTO v_response;
  IF jsonb_array_length(v_response->'history') <> 50 THEN
    RAISE EXCEPTION 'history tail must cap at 50, got %',
      jsonb_array_length(v_response->'history');
  END IF;
  IF (v_response->>'historyTruncated')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'historyTruncated must be true past 50 rows';
  END IF;
  IF jsonb_array_length(v_response->'events') <> 50 THEN
    RAISE EXCEPTION 'events tail must cap at 50, got %',
      jsonb_array_length(v_response->'events');
  END IF;
  IF (v_response->>'eventsTruncated')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'eventsTruncated must be true past 50 rows';
  END IF;

  SELECT private.refund_status_response(
    '9ef71000-0000-4000-8000-000000000002',
    '9ef70100-0000-4000-8000-000000000001',
    'NGN', 100, 50, 50, 0, 0, 'not_started', NULL, 0, 0,
    true, false, false, pg_catalog.now()
  ) INTO v_response;
  IF jsonb_array_length(v_response->'history') <> 50 THEN
    RAISE EXCEPTION 'exactly 50 history rows must all surface';
  END IF;
  IF (v_response->>'historyTruncated')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'historyTruncated must be false at exactly 50 rows';
  END IF;
  IF (v_response->>'eventsTruncated')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'eventsTruncated must be false at exactly 50 rows';
  END IF;
END;
$truncation_assert$;

ROLLBACK;
