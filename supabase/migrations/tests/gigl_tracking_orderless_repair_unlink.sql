-- REGRESSION: deleting the linked repair deactivates an orderless GIGL monitor.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '63a63d82-0000-4000-8000-000000000801';
  v_repair_id uuid := '63a63d82-0000-4000-8000-000000000802';
  v_shipment_id uuid;
  v_monitor_state text;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'gigl-orderless-unlink-regression@example.com',
    'GIGL Orderless Unlink Regression',
    'gigl-orderless-unlink-regression'
  );

  INSERT INTO public.shipments (
    merchant_id, provider, tracking_number, status,
    sender_address, receiver_address, items
  ) VALUES (
    v_merchant_id, 'GIGL', NULL, 'pending',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_shipment_id;

  INSERT INTO public.repairs (
    id,
    merchant_id,
    customer_name,
    customer_email,
    customer_phone,
    device_type,
    device_model,
    issue_description,
    service_type,
    pickup_address,
    status,
    shipment_id,
    pickup_payment_status,
    pickup_payment_reference,
    pickup_fee,
    pickup_currency
  ) VALUES (
    v_repair_id,
    v_merchant_id,
    'Ada Lovelace',
    'ada-orderless-unlink@example.com',
    '+2348012345678',
    'Smartphone',
    'iPhone 15',
    'Screen unresponsive',
    'pickup',
    '12 Station Road, Osogbo',
    'in_progress',
    v_shipment_id,
    'booked',
    'RPU-ORDERLESSUNLINK',
    8250,
    'NGN'
  );

  UPDATE public.shipments
  SET tracking_number = 'GIGL-ORDERLESS-UNLINK-001',
      status = 'booked'
  WHERE id = v_shipment_id;

  SELECT state INTO v_monitor_state
  FROM public.shipment_tracking_monitors
  WHERE shipment_id = v_shipment_id;

  IF v_monitor_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'linked repair pickup must enroll a GIGL monitor, got %',
      v_monitor_state;
  END IF;

  DELETE FROM public.repairs WHERE id = v_repair_id;

  UPDATE public.shipments
  SET status = status
  WHERE id = v_shipment_id;

  SELECT state INTO v_monitor_state
  FROM public.shipment_tracking_monitors
  WHERE shipment_id = v_shipment_id;

  IF v_monitor_state IS DISTINCT FROM 'inactive' THEN
    RAISE EXCEPTION
      'deleted repair must retire its orderless GIGL tracking monitor, got %',
      v_monitor_state;
  END IF;
END;
$test$;

ROLLBACK;
