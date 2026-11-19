BEGIN;

SELECT plan(5);

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
  FOREACH v_label IN ARRAY ARRAY['first_mile', 'genuine', 'terminal'] LOOP
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
       CASE v_label WHEN 'genuine' THEN 'MSHC' ELSE 'DPC' END,
       CASE v_label WHEN 'genuine' THEN 'out_for_delivery' ELSE 'in_transit' END,
       'scan b', '2026-11-09 12:00+00');
    UPDATE public.shipments SET status = CASE v_label WHEN 'terminal' THEN 'delivered' ELSE 'out_for_delivery' END,
      tracking_events = jsonb_build_array(
        jsonb_build_object('provider_event_key', v_label || '-a'),
        jsonb_build_object('provider_event_key', v_label || '-b'))
    WHERE id = v_ship;
    IF v_label = 'terminal' THEN
      UPDATE public.shipment_tracking_monitors SET state = 'terminal' WHERE shipment_id = v_ship;
    END IF;
  END LOOP;
END;
$setup$;

SELECT is(private.repair_gigl_first_mile_out_for_delivery(), 1,
  'repairs exactly the one first-mile shipment');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'first_mile')),
  'in_transit', 'first-mile shipment status follows its remaining events');
SELECT is((SELECT normalized_status FROM public.shipment_tracking_events WHERE provider_event_key = 'first_mile-a'),
  'pickup_scheduled', 'the first-mile MSHC event is reset');
SELECT is((SELECT status FROM public.shipments WHERE id = (SELECT shipment_id FROM repair_fixture WHERE label = 'genuine')),
  'out_for_delivery', 'a genuine delivery run is left alone');
SELECT is(private.repair_gigl_first_mile_out_for_delivery(), 0,
  'a second run repairs nothing (idempotent; terminal shipment untouched)');

SELECT * FROM finish();
ROLLBACK;
