-- Replay test: GIG notification map (policy rows, recipients, toggles, cancellation, shipped emails).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir pgtap_public_execute.sql
SET search_path = public, extensions;
SELECT plan(5);
GRANT USAGE ON SCHEMA extensions TO service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);


CREATE TEMP TABLE gigl_map_fixture (
  merchant_id uuid, order_id uuid, shipment_id uuid, epoch_id uuid,
  event_id uuid, owner_id uuid, fulfil_id uuid, viewer_id uuid
) ON COMMIT DROP;
GRANT ALL ON gigl_map_fixture TO PUBLIC;

DO $fixture$
DECLARE
  v_merchant_id uuid := '7a1c0000-0000-4000-8000-000000000001';
  v_owner uuid := '7a1c0000-0000-4000-8000-0000000000a1';
  v_fulfil uuid := '7a1c0000-0000-4000-8000-0000000000a2';
  v_viewer uuid := '7a1c0000-0000-4000-8000-0000000000a3';
  v_order uuid := '7a1c0000-0000-4000-8000-000000000002';
  v_shipment uuid;
  v_epoch uuid;
  v_event uuid;
  v_uid uuid;
BEGIN
  FOREACH v_uid IN ARRAY ARRAY[v_owner, v_fulfil, v_viewer] LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', v_uid::text || '@gigl-map.example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb
    );
  END LOOP;
  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (v_merchant_id, v_owner, 'gigl-map@example.com', 'GIGL Map', 'gigl-map');
  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES
    (v_merchant_id, v_fulfil, 'fulfil@gigl-map.example.com', 'Fulfil',
     'sales_rep', '{"orders": {"fulfill": true, "view": true}}'::jsonb, 'active'),
    (v_merchant_id, v_viewer, 'viewer@gigl-map.example.com', 'Viewer',
     'sales_rep', '{"orders": {"view": true}}'::jsonb, 'active');
  INSERT INTO public.orders (id, merchant_id, order_number, total)
  VALUES (v_order, v_merchant_id, 'GIGL-MAP-001', 1000);
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items, funding_source
  ) VALUES (
    v_order, v_merchant_id, 'GIGL', 'GIGL-MAP-001',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'external_manual'
  ) RETURNING id INTO v_shipment;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  ) VALUES (
    v_shipment, v_epoch, 'GIGL-MAP-001', 'GIGL', 'map-event', 'MPIK',
    'picked_up', 'Picked up', now()
  ) RETURNING id INTO v_event;
  INSERT INTO gigl_map_fixture VALUES (
    v_merchant_id, v_order, v_shipment, v_epoch, v_event, v_owner, v_fulfil, v_viewer
  );
END;
$fixture$;
-- 1. Policy rows (the whole suite runs as the migration owner with the service-role claim)
SELECT is(
  (SELECT count(*)::int FROM private.gigl_tracking_notification_policy AS p
   WHERE (p.raw_status IS NOT DISTINCT FROM 'DLP' AND p.audience = 'merchant' AND p.notification_kind = 'pickup_delayed')
      OR (p.normalized_status IS NOT DISTINCT FROM 'picked_up' AND p.audience = 'customer' AND p.notification_kind = 'picked_up')
      OR (p.normalized_status IS NOT DISTINCT FROM 'out_for_delivery' AND p.audience = 'merchant' AND p.notification_kind = 'out_for_delivery')
      OR (p.normalized_status IS NOT DISTINCT FROM 'delivered' AND p.audience = 'merchant' AND p.notification_kind = 'delivered')
      OR (p.normalized_status IS NOT DISTINCT FROM 'cancelled' AND p.audience = 'customer' AND p.notification_kind = 'cancelled')),
  5,
  'approved map adds DLP, customer picked_up, merchant out_for_delivery/delivered and customer cancelled'
);
-- 2. Role filter: owner + orders.fulfill staff only --------------------------------
DO $roles$
DECLARE
  f gigl_map_fixture%ROWTYPE;
  v_claim record;
BEGIN
  SELECT * INTO f FROM gigl_map_fixture;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'merchant', 'picked_up'
  );
  SELECT * INTO v_claim FROM public.claim_shipment_tracking_notifications(1, 'map-worker');
  IF v_claim.recipient_user_ids IS NULL
    OR NOT (f.owner_id = ANY (v_claim.recipient_user_ids))
    OR NOT (f.fulfil_id = ANY (v_claim.recipient_user_ids))
    OR f.viewer_id = ANY (v_claim.recipient_user_ids)
  THEN
    RAISE EXCEPTION 'merchant recipients must be owner + orders.fulfill staff, got %',
      v_claim.recipient_user_ids;
  END IF;
END;
$roles$;
SELECT pass('merchant push recipients are the owner plus orders.fulfill staff only');
-- 3. Toggle defaults ------------------------------------------------------------
DO $toggles$
DECLARE
  f gigl_map_fixture%ROWTYPE;
  v_status text;
  v_reason text;
BEGIN
  SELECT * INTO f FROM gigl_map_fixture;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'merchant', 'out_for_delivery'
  );
  SELECT status, skip_reason INTO v_status, v_reason
  FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'merchant'
    AND notification_kind = 'out_for_delivery';
  IF v_status <> 'skipped' OR v_reason <> 'merchant_preference_off' THEN
    RAISE EXCEPTION 'out_for_delivery must default OFF, got % / %', v_status, v_reason;
  END IF;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'merchant', 'delivered'
  );
  SELECT status INTO v_status FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'merchant'
    AND notification_kind = 'delivered';
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'delivered must default ON, got %', v_status;
  END IF;
  INSERT INTO public.notification_preferences (merchant_id, shipment_event_preferences)
  VALUES (f.merchant_id, '{"failed": false, "returned": true}'::jsonb);
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES
    (f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id, 'merchant', 'failed'),
    (f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id, 'merchant', 'returned');
  IF (SELECT status FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'merchant'
        AND notification_kind = 'failed') <> 'skipped'
    OR (SELECT status FROM public.shipment_tracking_notification_outbox
        WHERE shipment_id = f.shipment_id AND audience = 'merchant'
          AND notification_kind = 'returned') <> 'pending'
  THEN
    RAISE EXCEPTION 'merchant toggles must mute failed and keep returned';
  END IF;
END;
$toggles$;
SELECT pass('merchant event toggles default sensibly and can be muted per event');
\ir gigl_notification_map_cancel.inc.sql
SELECT pass('customer cancellation is dropped only when a newer live shipment exists');
-- 5. No shipped email at booking; shipped/failed/returned emails from GIG events --------------------------------
DO $shipped$
DECLARE
  f gigl_map_fixture%ROWTYPE;
  v_order uuid := '7a1c0000-0000-4000-8000-000000000003';
  v_shipment uuid;
  v_epoch uuid;
  v_event uuid;
  v_kind text;
BEGIN
  SELECT * INTO f FROM gigl_map_fixture;
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  VALUES (v_order, f.merchant_id, 'GIGL-MAP-003', 1000, 'processing');
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number, status,
    sender_address, receiver_address, items, funding_source
  ) VALUES (
    v_order, f.merchant_id, 'GIGL', 'GIGL-MAP-003', 'booked',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'external_manual'
  ) RETURNING id INTO v_shipment;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment;
  UPDATE public.orders SET shipping_status = 'shipped' WHERE id = v_order;
  IF EXISTS (
    SELECT 1 FROM public.order_notification_outbox
    WHERE order_id = v_order AND event_type = 'order_shipped'
  ) THEN
    RAISE EXCEPTION 'no shipped email may be queued while the GIG parcel is uncollected';
  END IF;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  ) VALUES (
    v_shipment, v_epoch, 'GIGL-MAP-003', 'GIGL', 'map-event-3', 'MPIK',
    'picked_up', 'Picked up', now()
  ) RETURNING id INTO v_event;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    v_shipment, v_epoch, v_order, f.merchant_id, v_event, 'customer', 'picked_up'
  );
  IF (SELECT count(*) FROM public.order_notification_outbox
      WHERE order_id = v_order AND event_type = 'order_shipped') <> 1 THEN
    RAISE EXCEPTION 'GIG pickup must queue exactly one shipped email';
  END IF;
  FOR v_kind IN SELECT unnest(ARRAY['delivery_attempt_failed', 'return_in_progress']) LOOP
    INSERT INTO public.shipment_tracking_notification_outbox (
      shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
      audience, notification_kind
    ) VALUES (
      v_shipment, v_epoch, v_order, f.merchant_id, v_event, 'customer', v_kind
    );
  END LOOP;
  IF (SELECT count(*) FROM public.order_notification_outbox
      WHERE order_id = v_order AND event_type = 'order_delivery_failed') <> 1
    OR (SELECT count(*) FROM public.order_notification_outbox
        WHERE order_id = v_order AND event_type = 'order_returned') <> 1 THEN
    RAISE EXCEPTION 'failed and returned GIG events must each queue one customer email';
  END IF;
END;
$shipped$;
SELECT pass('shipped email waits for GIG pickup and is queued exactly once');

SELECT * FROM finish();
ROLLBACK;