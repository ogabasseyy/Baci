-- Refund paths for gigl_provider_cancellation_wallet_refund.sql (\ir part).

-- T1 (regression): GIG's MSCC for a booked wallet charge refunds it once and
-- the cancellation persists. Before the fix this apply raised 55P03. Like the
-- real case, GIG's history is the MCRT this submission created plus MSCC,
-- which the worker attested as a waybill of Baci's own GIG account.
DO $t1$
DECLARE
  v_order constant uuid := pg_temp.fixture_id(2, 1);
  v_shipment constant uuid := pg_temp.fixture_id(4, 1);
  v_charge constant uuid := pg_temp.fixture_id(5, 1);
  v_before numeric := pg_temp.wallet_balance();
  v_after numeric;
  v_charge_row record;
  v_refund record;
  v_monitor record;
  v_order_row record;
BEGIN
  IF pg_temp.apply_gig_events(
       v_shipment, 'cancelled', pg_temp.fresh_cancel_history(1, 'MSCC')
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T1: the GIG cancellation must apply';
  END IF;
  v_after := pg_temp.wallet_balance();
  IF v_after IS DISTINCT FROM v_before + 48500.40 THEN
    RAISE EXCEPTION 'T1: wallet must rise by 48500.40, % -> %', v_before, v_after;
  END IF;
  IF pg_temp.refund_count(1) <> 1 THEN
    RAISE EXCEPTION 'T1: expected exactly one refund row, got %', pg_temp.refund_count(1);
  END IF;
  SELECT refund.id, refund.amount, refund.balance_after, refund.status,
    refund.metadata
  INTO v_refund
  FROM public.wallet_transactions AS refund
  WHERE refund.type = 'refund' AND refund.source_type = 'gigl_shipping'
    AND refund.source_id = v_order;
  IF v_refund.amount IS DISTINCT FROM 48500.40
     OR v_refund.balance_after IS DISTINCT FROM v_after
     OR v_refund.status IS DISTINCT FROM 'completed'
     OR v_refund.metadata ->> 'merchant_shipping_charge_id' IS DISTINCT FROM v_charge::text
     OR v_refund.metadata ->> 'waybill' IS DISTINCT FROM 'WB-CANCEL-1'
     OR v_refund.metadata ->> 'provider_raw_status' IS DISTINCT FROM 'MSCC'
     OR v_refund.metadata ->> 'prior_shipment_status' IS DISTINCT FROM 'booked'
     OR v_refund.metadata -> 'provider_account_attested' IS DISTINCT FROM 'true'::jsonb
     OR (v_refund.metadata ->> 'provider_created_at')::timestamptz IS DISTINCT FROM now()
     OR (v_refund.metadata ->> 'provider_cost')::numeric IS DISTINCT FROM 44091.27
     OR (v_refund.metadata ->> 'platform_margin')::numeric IS DISTINCT FROM 4409.13 THEN
    RAISE EXCEPTION 'T1: refund row is wrong: %', row_to_json(v_refund);
  END IF;
  SELECT charge.status, charge.refund_transaction_id, charge.refunded_at,
    charge.failure_code, charge.provider_reference
  INTO v_charge_row
  FROM public.merchant_shipping_charges AS charge
  WHERE charge.id = v_charge;
  IF v_charge_row.status IS DISTINCT FROM 'refunded'
     OR v_charge_row.refund_transaction_id IS DISTINCT FROM v_refund.id
     OR v_charge_row.refunded_at IS NULL
     OR v_charge_row.failure_code IS DISTINCT FROM 'PROVIDER_CANCELLED_AFTER_BOOKING'
     OR v_charge_row.provider_reference IS DISTINCT FROM 'WB-CANCEL-1' THEN
    RAISE EXCEPTION 'T1: charge must be refunded: %', row_to_json(v_charge_row);
  END IF;
  -- A GIG cancellation cancels only the shipping (20261114183000): the
  -- order goes back to processing, unlinked, so the merchant can rebook.
  IF (SELECT status FROM public.shipments WHERE id = v_shipment)
       IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'T1: the shipment must end cancelled';
  END IF;
  SELECT o.shipping_status, o.shipment_id, o.tracking_number,
    o.selected_quote_id, o.shipping_funding_source, o.cancelled_at
  INTO v_order_row
  FROM public.orders AS o WHERE o.id = v_order;
  IF v_order_row.shipping_status IS DISTINCT FROM 'processing'
     OR v_order_row.shipment_id IS NOT NULL
     OR v_order_row.tracking_number IS NOT NULL
     OR v_order_row.selected_quote_id IS NOT NULL
     OR v_order_row.shipping_funding_source IS NOT NULL
     OR v_order_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'T1: the order must reopen unlinked for rebooking: %',
      row_to_json(v_order_row);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shipment_tracking_notification_outbox AS outbox
    WHERE outbox.shipment_id = v_shipment AND outbox.audience = 'customer'
      AND outbox.notification_kind = 'cancelled' AND outbox.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'T1: a shipment-only cancellation must not alert the customer';
  END IF;
  SELECT monitor.state, monitor.next_poll_at, monitor.locked_by INTO v_monitor
  FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.shipment_id = v_shipment;
  IF v_monitor.state IS DISTINCT FROM 'terminal'
     OR v_monitor.next_poll_at IS NOT NULL
     OR v_monitor.locked_by IS NOT NULL THEN
    RAISE EXCEPTION 'T1: monitor must be terminal: %', row_to_json(v_monitor);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shipment_tracking_events AS event
    WHERE event.shipment_id = v_shipment AND event.raw_status = 'MSCC'
      AND event.normalized_status = 'cancelled'
      AND event.tracking_number = 'WB-CANCEL-1'
  ) THEN
    RAISE EXCEPTION 'T1: the MSCC event must persist';
  END IF;
END;
$t1$;

-- T2: re-applying the same GIG payload, calling the helper again and a stale
-- lease never refund twice.
DO $t2$
DECLARE
  v_shipment constant uuid := pg_temp.fixture_id(4, 1);
  v_balance numeric := pg_temp.wallet_balance();
  v_refund_id uuid := (
    SELECT charge.refund_transaction_id FROM public.merchant_shipping_charges AS charge
    WHERE charge.id = pg_temp.fixture_id(5, 1)
  );
  v_epoch uuid;
BEGIN
  UPDATE public.shipment_tracking_monitors
  SET state = 'final_poll', locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = v_shipment
  RETURNING tracking_epoch_id INTO v_epoch;
  IF pg_temp.apply_gig_events(
       v_shipment, 'cancelled', pg_temp.fresh_cancel_history(1, 'MSCC')
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T2: the re-applied cancellation must apply';
  END IF;
  UPDATE public.shipment_tracking_monitors
  SET locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = v_shipment;
  IF private.refund_gigl_wallet_charge_on_provider_cancellation(
       v_shipment, v_epoch, pg_temp.fixture_id(2, 1), 'booked',
       pg_temp.fresh_cancel_history(1, 'MSCC')
     ) <> 0 THEN
    RAISE EXCEPTION 'T2: a refunded charge must not be refunded again';
  END IF;
  UPDATE public.shipment_tracking_monitors
  SET locked_by = NULL, locked_at = NULL
  WHERE shipment_id = v_shipment;
  IF pg_temp.apply_gig_events(
       v_shipment, 'cancelled', pg_temp.fresh_cancel_history(1, 'MSCC')
     ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T2: an apply without the lease must return false';
  END IF;
  IF pg_temp.refund_count(1) <> 1
     OR pg_temp.wallet_balance() IS DISTINCT FROM v_balance
     OR (SELECT charge.refund_transaction_id FROM public.merchant_shipping_charges AS charge
         WHERE charge.id = pg_temp.fixture_id(5, 1)) IS DISTINCT FROM v_refund_id THEN
    RAISE EXCEPTION 'T2: retries must leave one refund and the balance unchanged';
  END IF;
END;
$t2$;

-- T3: the partial unique index rejects a second provider-cancellation refund
-- for the same charge, but not refunds without the charge key.
DO $t3$
DECLARE
  v_wallet uuid := (
    SELECT wallet.id FROM public.merchant_wallets AS wallet
    WHERE wallet.merchant_id = 'c4ce1100-0000-4000-8000-000000000001'
  );
BEGIN
  BEGIN
    INSERT INTO public.wallet_transactions (
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status, metadata
    ) VALUES (
      v_wallet, 'c4ce1100-0000-4000-8000-000000000001', 'refund', 48500.40, 0,
      'gigl_shipping', pg_temp.fixture_id(2, 1), 'duplicate', 'completed',
      jsonb_build_object('merchant_shipping_charge_id', pg_temp.fixture_id(5, 1))
    );
    RAISE EXCEPTION 'T3: a second refund for one charge must be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF pg_temp.refund_count(1) <> 1 THEN
    RAISE EXCEPTION 'T3: the rejected duplicate must not persist';
  END IF;
  INSERT INTO public.wallet_transactions (
    wallet_id, merchant_id, type, amount, balance_after, source_type,
    source_id, description, status
  ) VALUES
    (v_wallet, 'c4ce1100-0000-4000-8000-000000000001', 'refund', 1, 0,
      'gigl_shipping', pg_temp.fixture_id(2, 99), 'reservation refund', 'completed'),
    (v_wallet, 'c4ce1100-0000-4000-8000-000000000001', 'refund', 1, 0,
      'gigl_shipping', pg_temp.fixture_id(2, 99), 'reservation refund', 'completed');
END;
$t3$;

-- T7: no charge, nothing to refund. A customer-checkout GIGL order and an
-- orderless repair pickup still cancel the shipment; the order reopens.
DO $t7$
DECLARE
  v_merchant constant uuid := 'c4ce1100-0000-4000-8000-000000000001';
  v_orderless constant uuid := pg_temp.fixture_id(4, 70);
  v_applied boolean;
BEGIN
  -- Apply first, then assert: an OR chain may evaluate its parts in any order.
  v_applied := pg_temp.apply_gig_status(
    pg_temp.fixture_id(4, 7), 'cancelled', 'SSC', 'SSC:7', now()
  );
  IF v_applied IS DISTINCT FROM true
     OR (SELECT shipping_status FROM public.orders WHERE id = pg_temp.fixture_id(2, 7))
       IS DISTINCT FROM 'processing'
     OR (SELECT shipment_id FROM public.orders WHERE id = pg_temp.fixture_id(2, 7))
       IS NOT NULL
     OR (SELECT status FROM public.shipments WHERE id = pg_temp.fixture_id(4, 7))
       IS DISTINCT FROM 'cancelled'
     OR (SELECT state FROM public.shipment_tracking_monitors
         WHERE shipment_id = pg_temp.fixture_id(4, 7)) IS DISTINCT FROM 'terminal'
     OR EXISTS (SELECT 1 FROM public.wallet_transactions
                WHERE source_id = pg_temp.fixture_id(2, 7)) THEN
    RAISE EXCEPTION 'T7: customer-checkout cancellation must persist with no wallet rows';
  END IF;

  INSERT INTO public.shipments (
    id, merchant_id, provider, tracking_number, status,
    sender_address, receiver_address, items
  ) VALUES (
    v_orderless, v_merchant, 'GIGL', NULL, 'pending',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  );
  INSERT INTO public.repairs (
    id, merchant_id, customer_name, customer_email, customer_phone,
    device_type, device_model, issue_description, service_type,
    pickup_address, status, shipment_id, pickup_payment_status,
    pickup_payment_reference, pickup_fee, pickup_currency
  ) VALUES (
    'c4ce1900-0000-4000-8000-000000000070', v_merchant, 'Ada Lovelace',
    'gigl-cancel-refund-repair@example.test', '+2348012345678', 'Smartphone',
    'iPhone 15', 'Screen unresponsive', 'pickup', '12 Station Road, Osogbo',
    'in_progress', v_orderless, 'booked', 'RPU-GIGLCANCELREFUND', 8250, 'NGN'
  );
  UPDATE public.shipments
  SET tracking_number = 'WB-CANCEL-70', status = 'booked'
  WHERE id = v_orderless;
  UPDATE public.shipment_tracking_monitors
  SET locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = v_orderless;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T7: a linked repair pickup must enroll a monitor';
  END IF;
  v_applied := pg_temp.apply_gig_status(
    v_orderless, 'cancelled', 'MSCC', 'MSCC:70', now()
  );
  IF v_applied IS DISTINCT FROM true
     OR (SELECT status FROM public.shipments WHERE id = v_orderless)
       IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'T7: an orderless repair pickup cancellation must apply';
  END IF;
END;
$t7$;

-- T8: complete_merchant_shipping_charge stamps the booked waybill, and later
-- status writes or tracking edits never re-stamp it.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', 'c4ce1000-0000-4000-8000-000000000001', true
);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $t8_complete$
BEGIN
  IF public.complete_merchant_shipping_charge(
       'c4ce1500-0000-4000-8000-000000000008', 'attempt-8',
       'c4ce1400-0000-4000-8000-000000000008'
     ) IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'T8: the owner must complete the booking';
  END IF;
END;
$t8_complete$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $t8$
DECLARE
  v_charge constant uuid := pg_temp.fixture_id(5, 8);
BEGIN
  IF (SELECT provider_reference FROM public.merchant_shipping_charges WHERE id = v_charge)
     IS DISTINCT FROM 'WB-CANCEL-8' THEN
    RAISE EXCEPTION 'T8: booking must stamp the shipment waybill';
  END IF;
  UPDATE public.shipments SET tracking_number = 'WB-SWAPPED-8'
  WHERE id = pg_temp.fixture_id(4, 8);
  UPDATE public.merchant_shipping_charges SET status = 'booked' WHERE id = v_charge;
  UPDATE public.merchant_shipping_charges SET status = 'refunded'
  WHERE id = pg_temp.fixture_id(5, 1);
  IF (SELECT provider_reference FROM public.merchant_shipping_charges WHERE id = v_charge)
       IS DISTINCT FROM 'WB-CANCEL-8'
     OR (SELECT provider_reference FROM public.merchant_shipping_charges
         WHERE id = pg_temp.fixture_id(5, 1)) IS DISTINCT FROM 'WB-CANCEL-1' THEN
    RAISE EXCEPTION 'T8: the stamped waybill must never move';
  END IF;
END;
$t8$;
