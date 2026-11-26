BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir ../../tests/pgtap_public_execute.sql
SET search_path = public, extensions;

SELECT plan(12);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE repair_fixture (label text PRIMARY KEY, shipment_id uuid);

DO $setup$
DECLARE
  v_merchant uuid := '63a63d84-0000-4000-8000-000000000101';
  v_label text;
  v_order uuid;
  v_ship uuid;
  v_epoch uuid;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant, 'gigl-first-mile-repair@example.com', 'GIGL Repair', 'gigl-first-mile-repair');
  FOREACH v_label IN ARRAY ARRAY['first_mile', 'genuine', 'terminal', 'then_failed', 'with_sdr', 'with_terminal', 'camel'] LOOP
    INSERT INTO public.orders (merchant_id, order_number, total)
    VALUES (v_merchant, 'GIGL-REPAIR-' || v_label, 1000) RETURNING id INTO v_order;
    INSERT INTO public.shipments (
      order_id, merchant_id, provider, tracking_number,
      sender_address, receiver_address, items
    ) VALUES (v_order, v_merchant, 'GIGL', 'GIGL-REPAIR-' || v_label,
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb) RETURNING id INTO v_ship;
    SELECT tracking_epoch_id INTO v_epoch
    FROM public.shipment_tracking_monitors WHERE shipment_id = v_ship;
    INSERT INTO repair_fixture VALUES (v_label, v_ship);
    -- first_mile: MSHC then a later DPC; genuine: DPC then MSHC; terminal: delivered.
    INSERT INTO public.shipment_tracking_events (
      shipment_id, tracking_epoch_id, tracking_number, provider,
      provider_event_key, raw_status, normalized_status, description, occurred_at
    ) VALUES
      (v_ship, v_epoch, 'GIGL-REPAIR-' || v_label, 'GIGL', v_label || '-a',
       CASE v_label WHEN 'genuine' THEN 'DPC' ELSE 'MSHC' END,
       CASE v_label WHEN 'genuine' THEN 'in_transit' ELSE 'out_for_delivery' END,
       'scan a', '2026-11-09 10:00+00'),
      (v_ship, v_epoch, 'GIGL-REPAIR-' || v_label, 'GIGL', v_label || '-b',
       CASE v_label WHEN 'genuine' THEN 'MSHC' WHEN 'then_failed' THEN 'DELIVERY_FAILED' ELSE 'DPC' END,
       CASE v_label WHEN 'genuine' THEN 'out_for_delivery' WHEN 'then_failed' THEN 'failed' ELSE 'in_transit' END,
       'scan b', '2026-11-09 12:00+00');
    IF v_label = 'first_mile' THEN
      INSERT INTO public.shipment_tracking_notification_outbox (
        shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
        audience, notification_kind
      ) SELECT v_ship, v_epoch, v_order, v_merchant, event.id, 'merchant', 'out_for_delivery'
      FROM public.shipment_tracking_events AS event
      WHERE event.shipment_id = v_ship AND event.provider_event_key = 'first_mile-a';
    END IF;
    -- with_sdr / with_terminal: histories the repair deliberately leaves alone.
    IF v_label IN ('with_sdr', 'with_terminal') THEN
      INSERT INTO public.shipment_tracking_events (
        shipment_id, tracking_epoch_id, tracking_number, provider,
        provider_event_key, raw_status, normalized_status, description, occurred_at
      ) VALUES (
        v_ship, v_epoch, 'GIGL-REPAIR-' || v_label, 'GIGL', v_label || '-x',
        CASE v_label WHEN 'with_sdr' THEN 'SDR' ELSE 'SHD' END,
        CASE v_label WHEN 'with_sdr' THEN 'failed' ELSE 'delivered' END,
        'special scan', '2026-11-09 11:00+00');
    END IF;
    UPDATE public.shipments SET status = CASE v_label WHEN 'terminal' THEN 'delivered' ELSE 'out_for_delivery' END,
      tracking_events = CASE WHEN v_label = 'camel'
        THEN jsonb_build_array(
          jsonb_build_object('providerEventKey', v_label || '-a', 'status', 'out_for_delivery'),
          jsonb_build_object('providerEventKey', v_label || '-b', 'status', 'in_transit'))
        ELSE jsonb_build_array(
          jsonb_build_object('provider_event_key', v_label || '-a'),
          jsonb_build_object('provider_event_key', v_label || '-b'))
      END
    WHERE id = v_ship;
    IF v_label = 'terminal' THEN
      UPDATE public.shipment_tracking_monitors SET state = 'terminal' WHERE shipment_id = v_ship;
    END IF;
  END LOOP;
END;
$setup$;

SELECT is(private.repair_gigl_first_mile_out_for_delivery(), 3,
  'repairs the first-mile, MSHC-then-failed and camel-case snapshot shipments');
SELECT is((SELECT tracking_events->0->>'status' FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'camel')),
  'pickup_scheduled', 'a track-route (camel-case) snapshot entry is patched too');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'then_failed')),
  'failed', 'a failed scan after the demoted MSHC stays failed');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'first_mile')),
  'in_transit', 'first-mile shipment status follows its remaining events');
SELECT is((SELECT normalized_status FROM public.shipment_tracking_events WHERE provider_event_key = 'first_mile-a'),
  'pickup_scheduled', 'the first-mile MSHC event is reset');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'genuine')),
  'out_for_delivery', 'a genuine delivery run is left alone');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'with_sdr')),
  'out_for_delivery', 'a history with an SDR is left to the normal poller');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'with_terminal')),
  'out_for_delivery', 'a history with a terminal event is left to the normal poller');
SELECT is((SELECT count(*)::int FROM public.shipment_tracking_notification_outbox WHERE shipment_id = (SELECT shipment_id FROM repair_fixture WHERE label = 'first_mile')),
  0, 'a pending out_for_delivery update for the demoted scan is removed');
SELECT lives_ok($$
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) SELECT s.id, e.tracking_epoch_id, s.order_id, s.merchant_id, e.id, 'merchant', 'out_for_delivery'
  FROM public.shipments AS s
  JOIN public.shipment_tracking_events AS e
    ON e.shipment_id = s.id AND e.provider_event_key = 'first_mile-b'
  WHERE s.id = (SELECT shipment_id FROM repair_fixture WHERE label = 'first_mile')
$$, 'a later genuine out_for_delivery notice can claim the freed milestone identity');
SELECT is((SELECT m.state || ':' || coalesce(m.manual_terminal_override_at::text, 'none')
  FROM public.shipment_tracking_monitors AS m
  WHERE m.shipment_id = (SELECT shipment_id FROM repair_fixture WHERE label = 'then_failed')),
  'active:none', 'repairing to failed leaves the monitor active with no manual override');
SELECT is(private.repair_gigl_first_mile_out_for_delivery(), 0,
  'a second run repairs nothing (idempotent; terminal shipment untouched)');

SELECT * FROM finish();
ROLLBACK;
