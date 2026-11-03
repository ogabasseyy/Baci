-- Functional parity and authorization regression for the website-performance RPC.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('ba0d0e12-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'website-owner@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ba0d0e12-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'website-staff@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ba0d0e12-0000-4000-8000-000000000003',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'website-denied@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ba0d0e12-0000-4000-8000-000000000004',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'website-other@example.com', 'test', now(), now(), now(),
   '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, is_published
) VALUES
  ('ba0d0e12-0000-4000-8000-000000000101',
   'ba0d0e12-0000-4000-8000-000000000001',
   'website-owner@example.com', 'Website Metrics Fixture',
   'website-metrics-fixture', true),
  ('ba0d0e12-0000-4000-8000-000000000102',
   'ba0d0e12-0000-4000-8000-000000000004',
   'website-other@example.com', 'Other Website Metrics Fixture',
   'other-website-metrics-fixture', true);

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES
  ('ba0d0e12-0000-4000-8000-000000000101',
   'ba0d0e12-0000-4000-8000-000000000002',
   'website-staff@example.com', 'Website Analytics Staff', 'accountant',
   '{"analytics":{"view":true}}', 'active'),
  ('ba0d0e12-0000-4000-8000-000000000101',
   'ba0d0e12-0000-4000-8000-000000000003',
   'website-denied@example.com', 'Website Analytics Denied', 'accountant',
   '{"*":{"*":false,"view":false},"analytics":{"*":false,"view":false,"all":false},"full_access":{"all":false}}',
   'active');

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
) VALUES
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"search_term":" Phone "}', '2026-07-02T10:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"phone"}', '2026-07-02T11:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"search_term":"Case"}', '2026-07-02T12:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":" CASE "}', '2026-07-02T13:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"  "}', '2026-07-02T14:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000102', 'search',
   '{"query":"phone"}', '2026-07-02T15:00:00Z'),
  ('ba0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"phone"}', '2026-05-02T15:00:00Z');

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'ba0d0e12-0000-4000-8000-000000000101',
  'product_view',
  '{"product_id":"p1","product_name":"Phone","items":[{"id":"p1","name":"Phone"},{"id":"p1","name":"Phone"}]}'::jsonb,
  '2026-07-03T10:00:00Z'::timestamptz + sequence * interval '1 minute'
FROM pg_catalog.generate_series(1, 10) AS sequence;

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'ba0d0e12-0000-4000-8000-000000000101',
  'product_view',
  '{"items":[{"id":"p2","name":"Tablet"}]}'::jsonb,
  '2026-07-04T10:00:00Z'::timestamptz + sequence * interval '1 minute'
FROM pg_catalog.generate_series(1, 10) AS sequence;

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'ba0d0e12-0000-4000-8000-000000000101',
  'add_to_cart',
  '{"product_id":"p1","product_name":"Phone","items":[{"id":"p1","name":"Phone"}]}'::jsonb,
  '2026-07-05T10:00:00Z'::timestamptz + sequence * interval '1 minute'
FROM pg_catalog.generate_series(1, 5) AS sequence;

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'ba0d0e12-0000-4000-8000-000000000101',
  'purchase',
  '{"items":[{"product_id":"p2","product_name":"Tablet"}]}'::jsonb,
  '2026-07-06T10:00:00Z'::timestamptz + sequence * interval '1 minute'
FROM pg_catalog.generate_series(1, 6) AS sequence;

CREATE FUNCTION pg_temp.assert_website_summary(
  p_user_id uuid,
  p_expected jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actual jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT public.get_website_performance_event_summary(
    'ba0d0e12-0000-4000-8000-000000000101',
    '2026-07-01T00:00:00Z',
    '2026-07-10T00:00:00Z'
  ) INTO v_actual;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'expected website summary %, got %', p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_website_summary(uuid, jsonb) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.assert_website_summary(
  'ba0d0e12-0000-4000-8000-000000000001',
  '{"mostSearched":{"query":"case","count":2},"topConverting":{"id":"p2","name":"Tablet","conversionRate":60,"views":10,"actions":6}}'
);
SELECT pg_temp.assert_website_summary(
  'ba0d0e12-0000-4000-8000-000000000002',
  '{"mostSearched":{"query":"case","count":2},"topConverting":{"id":"p2","name":"Tablet","conversionRate":60,"views":10,"actions":6}}'
);

DO $product_extraction$
DECLARE
  v_actual jsonb;
  v_expected constant jsonb :=
    '{"id":"p1","name":"Phone","conversionRate":50,"views":10,"actions":5}';
BEGIN
  SELECT public.get_website_performance_event_summary(
    'ba0d0e12-0000-4000-8000-000000000101',
    '2026-07-03T00:00:00Z',
    '2026-07-06T00:00:00Z'
  ) -> 'topConverting' INTO v_actual;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'deduplicated p1 extraction expected %, got %',
      v_expected, v_actual;
  END IF;
END;
$product_extraction$;

DO $authorization_guards$
DECLARE
  v_rejected boolean;
  v_user_id uuid;
BEGIN
  FOREACH v_user_id IN ARRAY ARRAY[
    'ba0d0e12-0000-4000-8000-000000000003'::uuid,
    'ba0d0e12-0000-4000-8000-000000000004'::uuid
  ] LOOP
    PERFORM pg_catalog.set_config(
      'request.jwt.claim.sub', v_user_id::text, true
    );
    v_rejected := false;
    BEGIN
      PERFORM public.get_website_performance_event_summary(
        'ba0d0e12-0000-4000-8000-000000000101',
        '2026-07-01T00:00:00Z',
        '2026-07-10T00:00:00Z'
      );
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'unauthorized user % read website metrics', v_user_id;
    END IF;
  END LOOP;
END;
$authorization_guards$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
DO $service_role_bypass$
DECLARE
  v_actual jsonb;
  v_expected constant jsonb :=
    '{"mostSearched":{"query":"case","count":2},"topConverting":{"id":"p2","name":"Tablet","conversionRate":60,"views":10,"actions":6}}';
BEGIN
  SELECT public.get_website_performance_event_summary(
    'ba0d0e12-0000-4000-8000-000000000101',
    '2026-07-01T00:00:00Z',
    '2026-07-10T00:00:00Z'
  ) INTO v_actual;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'service role expected website summary %, got %',
      v_expected, v_actual;
  END IF;
END;
$service_role_bypass$;
RESET ROLE;

DO $argument_guards$
DECLARE
  v_rejected boolean;
BEGIN
  SELECT public.get_website_performance_event_summary(
    'ba0d0e12-0000-4000-8000-000000000101',
    '2026-06-01T00:00:00Z',
    '2026-06-02T00:00:00Z'
  ) IS DISTINCT FROM '{"mostSearched":null,"topConverting":null}'::jsonb
  INTO v_rejected;
  IF v_rejected THEN
    RAISE EXCEPTION 'empty range did not return a null summary';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.get_website_performance_event_summary(
      'ba0d0e12-0000-4000-8000-000000000101',
      '2026-07-10T00:00:00Z',
      '2026-07-01T00:00:00Z'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'reversed date range unexpectedly accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.get_website_performance_event_summary(
      'ba0d0e12-0000-4000-8000-000000000101',
      '2026-05-01T00:00:00Z',
      '2026-07-01T00:00:00Z'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'oversized date range unexpectedly accepted';
  END IF;
END;
$argument_guards$;

ROLLBACK;
