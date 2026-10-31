-- Boundary, capping, and deterministic ranking coverage for website metrics.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.merchants (
  id, email, business_name, slug, is_published
) VALUES (
  'bb0d0e12-0000-4000-8000-000000000101',
  'website-edges@example.com',
  'Website Metrics Edge Fixture',
  'website-metrics-edge-fixture',
  true
);

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
) VALUES
  ('bb0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"boundary"}', '2026-06-30T23:59:59.999999Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"boundary"}', '2026-07-01T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'search',
   '{"search_term":" Boundary "}', '2026-07-10T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'search',
   '{"query":"boundary"}', '2026-07-10T00:00:00.000001Z');

-- Alpha's exact-boundary events count; its just-outside events do not.
INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
) VALUES
  ('bb0d0e12-0000-4000-8000-000000000101', 'product_view',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-01T23:59:59.999999Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'product_view',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-02T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'product_view',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-04T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'product_view',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-04T00:00:00.000001Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'add_to_cart',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-01T23:59:59.999999Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'add_to_cart',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-02T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'add_to_cart',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-04T00:00:00Z'),
  ('bb0d0e12-0000-4000-8000-000000000101', 'add_to_cart',
   '{"product_id":"p1","product_name":"Alpha Tie"}',
   '2026-07-04T00:00:00.000001Z');

INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'bb0d0e12-0000-4000-8000-000000000101',
  activity.event_type,
  pg_catalog.jsonb_build_object(
    'product_id', activity.product_id,
    'product_name', activity.product_name
  ),
  activity.base_time + sequence * interval '1 minute'
FROM (
  VALUES
    ('product_view', 'p1', 'Alpha Tie',
     '2026-07-02T01:00:00Z'::timestamptz, 8),
    ('add_to_cart', 'p1', 'Alpha Tie',
     '2026-07-03T01:00:00Z'::timestamptz, 10),
    ('product_view', 'p2', 'Zulu Tie',
     '2026-07-02T02:00:00Z'::timestamptz, 10),
    ('add_to_cart', 'p2', 'Zulu Tie',
     '2026-07-03T02:00:00Z'::timestamptz, 12)
) AS activity(event_type, product_id, product_name, base_time, event_count)
CROSS JOIN LATERAL pg_catalog.generate_series(
  1, activity.event_count
) AS sequence;

-- Both products cap at 100%; the lexically later product has more raw actions.
INSERT INTO public.analytics_events (
  merchant_id, event_type, event_data, event_timestamp
)
SELECT
  'bb0d0e12-0000-4000-8000-000000000101',
  activity.event_type,
  pg_catalog.jsonb_build_object(
    'product_id', activity.product_id,
    'product_name', activity.product_name
  ),
  activity.base_time + sequence * interval '1 minute'
FROM (
  VALUES
    ('product_view', 'p3', 'Alpha Raw',
     '2026-07-05T01:00:00Z'::timestamptz, 10),
    ('add_to_cart', 'p3', 'Alpha Raw',
     '2026-07-06T01:00:00Z'::timestamptz, 12),
    ('product_view', 'p4', 'Zulu Raw',
     '2026-07-05T02:00:00Z'::timestamptz, 10),
    ('add_to_cart', 'p4', 'Zulu Raw',
     '2026-07-06T02:00:00Z'::timestamptz, 13)
) AS activity(event_type, product_id, product_name, base_time, event_count)
CROSS JOIN LATERAL pg_catalog.generate_series(
  1, activity.event_count
) AS sequence;

CREATE FUNCTION pg_temp.assert_website_summary_edge(
  p_start_at timestamp with time zone,
  p_end_at timestamp with time zone,
  p_expected jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actual jsonb;
BEGIN
  SELECT public.get_website_performance_event_summary(
    'bb0d0e12-0000-4000-8000-000000000101',
    p_start_at,
    p_end_at
  ) INTO v_actual;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'expected website edge summary %, got %',
      p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_website_summary_edge(timestamp with time zone, timestamp with time zone, jsonb) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_website_summary_edge(
  '2026-07-02T00:00:00Z',
  '2026-07-04T00:00:00Z',
  '{"mostSearched":null,"topConverting":{"id":"p1","name":"Alpha Tie","conversionRate":100,"views":10,"actions":10}}'
);
SELECT pg_temp.assert_website_summary_edge(
  '2026-07-05T00:00:00Z',
  '2026-07-07T00:00:00Z',
  '{"mostSearched":null,"topConverting":{"id":"p4","name":"Zulu Raw","conversionRate":100,"views":10,"actions":10}}'
);
SELECT pg_temp.assert_website_summary_edge(
  '2026-07-01T00:00:00Z',
  '2026-07-10T00:00:00Z',
  '{"mostSearched":{"query":"boundary","count":2},"topConverting":{"id":"p1","name":"Alpha Tie","conversionRate":100,"views":12,"actions":12}}'
);
RESET ROLE;

ROLLBACK;
