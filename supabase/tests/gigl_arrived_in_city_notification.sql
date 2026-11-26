-- Replay test: GIG "arrived in your city" (policy rows, one push per arrival scan, shipped email).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir pgtap_public_execute.sql
SET search_path = public, extensions;
SELECT plan(4);
GRANT USAGE ON SCHEMA extensions TO service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE gigl_arrival_fixture (
  merchant_id uuid, order_id uuid, shipment_id uuid, epoch_id uuid
) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_merchant uuid := '7a2c0000-0000-4000-8000-000000000001';
  v_owner uuid := '7a2c0000-0000-4000-8000-0000000000a1';
  v_order uuid := '7a2c0000-0000-4000-8000-000000000002';
  v_shipment uuid;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'owner@gigl-arrival.example.com', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (v_merchant, v_owner, 'gigl-arrival@example.com', 'GIGL Arrival', 'gigl-arrival');
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  VALUES (v_order, v_merchant, 'GIGL-ARR-001', 1000, 'processing');
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number, status,
    sender_address, receiver_address, items, funding_source
  ) VALUES (
    v_order, v_merchant, 'GIGL', 'GIGL-ARR-001', 'booked',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'external_manual'
  ) RETURNING id INTO v_shipment;
  INSERT INTO gigl_arrival_fixture
  SELECT v_merchant, v_order, v_shipment, tracking_epoch_id
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment;
END;
$fixture$;

SELECT is(
  (SELECT array_agg(notification_kind ORDER BY notification_kind)
   FROM private.gigl_tracking_notification_policy
   WHERE raw_status = 'ARRIVED IN DESTINATION CITY' AND audience = 'customer'),
  ARRAY['arrived_in_city', 'transit_started'],
  'the arrival raw status maps to both customer kinds'
);

-- A catch-up poll, as the apply RPC queues it in one statement: an earlier
-- in-transit scan owns the transit_started row, the arrival scan the other.
WITH event AS (
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  )
  SELECT f.shipment_id, f.epoch_id, 'GIGL-ARR-001', 'GIGL', scan.key,
    scan.raw, 'in_transit', scan.raw, now() - scan.age
  FROM gigl_arrival_fixture AS f,
    (VALUES
      ('departed-event', 'DPC', interval '2 hours'),
      ('arrival-event', 'ARRIVED IN DESTINATION CITY', interval '1 hour')
    ) AS scan(key, raw, age)
  RETURNING id, raw_status
)
INSERT INTO public.shipment_tracking_notification_outbox (
  shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
  audience, notification_kind
)
SELECT f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, event.id,
  'customer', queued.kind
FROM gigl_arrival_fixture AS f
JOIN (VALUES
  ('DPC', 'transit_started'),
  ('ARRIVED IN DESTINATION CITY', 'arrived_in_city')
) AS queued(raw, kind) ON true
JOIN event ON event.raw_status = queued.raw;

SELECT is(
  (SELECT status FROM public.shipment_tracking_notification_outbox
   WHERE shipment_id = (SELECT shipment_id FROM gigl_arrival_fixture)
     AND audience = 'customer' AND notification_kind = 'arrived_in_city'),
  'pending',
  'the arrival push stays queued'
);
SELECT is(
  (SELECT status || '/' || skip_reason
   FROM public.shipment_tracking_notification_outbox
   WHERE shipment_id = (SELECT shipment_id FROM gigl_arrival_fixture)
     AND audience = 'customer' AND notification_kind = 'transit_started'),
  'skipped/covered_by_arrival_push',
  'the in-transit push from the same poll is skipped, not deleted'
);
SELECT is(
  (SELECT count(*)::int FROM public.order_notification_outbox
   WHERE order_id = (SELECT order_id FROM gigl_arrival_fixture)
     AND event_type = 'order_shipped'),
  1,
  'the shipped email is still queued'
);

SELECT * FROM finish();
ROLLBACK;
