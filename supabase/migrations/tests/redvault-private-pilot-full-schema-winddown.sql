-- redvault-private-pilot-full-schema-winddown.sql
-- Part 6/6: post-expiry provider outcomes, cancel carve-outs, product boundary, and binding checks; reports success and rolls back.
--
-- Runs concatenated with the other parts in filename order inside one
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- do not run standalone.

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  BEGIN
    UPDATE private.uba_redvault_payment_attempts SET state = 'initializing' WHERE id = fixture.attempt_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_disabled_or_expired' THEN
    RAISE EXCEPTION 'expired_reinitialize_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  -- Wind-down probes run inside a protected write context (removed at the end
  -- of this block) so they isolate the pilot guard from the unscoped-write
  -- trigger. Both cancel spellings must stay allowed; fulfillment writes must
  -- stay blocked before and after cancellation.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  -- Verified-payment completion advances pending -> processing (paid flip in
  -- the same statement); the pilot guard must permit exactly that transition
  -- while failing closed on the reversal.
  UPDATE public.orders SET shipping_status = 'processing' WHERE id = fixture.order_id;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = fixture.order_id AND shipping_status = 'processing') THEN
    RAISE EXCEPTION 'pilot_completion_transition_rejected';
  END IF;
  caught := NULL;
  BEGIN
    UPDATE public.orders SET shipping_status = 'pending' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'pilot_completion_reversal_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  UPDATE public.orders SET shipping_status = 'canceled' WHERE id = fixture.order_id;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = fixture.order_id AND shipping_status = 'canceled') THEN
    RAISE EXCEPTION 'pilot_cancel_carve_out_rejected';
  END IF;
  -- A wound-down order must never reserve again, under either spelling:
  -- approval rejects both, so reservation must fail before provider
  -- capture rather than stranding funds in captured-held.
  caught := NULL;
  BEGIN
    PERFORM * FROM public.reserve_storefront_redvault_payment_attempt_v3(fixture.order_id);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_cancelled' THEN
    RAISE EXCEPTION 'pilot_canceled_reserve_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    UPDATE public.orders SET shipping_status = 'shipped' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'canceled_pilot_fulfillment_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  UPDATE public.orders SET shipping_status = 'cancelled' WHERE id = fixture.order_id;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = fixture.order_id AND shipping_status = 'cancelled') THEN
    RAISE EXCEPTION 'pilot_cancel_carve_out_rejected';
  END IF;
  caught := NULL;
  BEGIN
    UPDATE public.orders SET shipping_status = 'shipped', tracking_number = 'RV-REOPEN-PROBE'
    WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'cancelled_pilot_fulfillment_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  probe_order_id uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- Normal-path probe order: a non-REDVAULT payment method stays outside
  -- the unscoped-order trigger, isolating the product boundary below.
  INSERT INTO public.orders(merchant_id, order_number, total, payment_method, payment_status, shipping_status)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'RV-PILOT-PRODUCT-PROBE', 100, 'paystack', 'unpaid', 'pending')
  RETURNING id INTO probe_order_id;
  BEGIN
    INSERT INTO public.order_items(order_id, product_id, name, price, quantity)
    VALUES (probe_order_id, fixture.product_id, 'REDVAULT pilot probe', 100, 1);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_product_restricted' THEN
    RAISE EXCEPTION 'pilot_product_boundary_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  -- Ordinary products stay orderable on the normal path.
  INSERT INTO public.order_items(order_id, product_id, name, price, quantity)
  VALUES (probe_order_id, fixture.ordinary_product_id, 'REDVAULT ordinary probe', 100, 1);
  -- Swapping a line to the bound product is the same boundary violation.
  caught := NULL;
  BEGIN
    UPDATE public.order_items SET product_id = fixture.product_id
    WHERE order_id = probe_order_id AND product_id = fixture.ordinary_product_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_product_restricted' THEN
    RAISE EXCEPTION 'pilot_product_swap_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  -- The protected REDVAULT path (write context present, as the order-draft
  -- RPC establishes) retains access for the pilot order flow.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.order_items(order_id, product_id, name, price, quantity)
  VALUES (probe_order_id, fixture.product_id, 'REDVAULT pilot probe', 100, 1);
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- The fixture order was wound down as `cancelled` above: reservation
  -- must reject it (same guard as the legacy spelling, both spellings
  -- covered across the two probes).
  BEGIN
    PERFORM * FROM public.reserve_storefront_redvault_payment_attempt_v3(fixture.order_id);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_cancelled' THEN
    RAISE EXCEPTION 'pilot_cancelled_reserve_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = fixture.order_id AND payment_status <> 'unpaid') THEN
    RAISE EXCEPTION 'test_changed_payment_state';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts WHERE id = fixture.attempt_id
    AND (authorization_url IS NOT NULL OR state IN ('approved', 'captured_held'))) THEN
    RAISE EXCEPTION 'test_performed_or_simulated_provider_completion';
  END IF;
END;
$$;

SELECT 'Full-schema REDVAULT pilot, legacy RPC revocation, non-pilot compatibility, shipment insert/update, cap, expiry, pre-approval fulfillment block, completion transition, cancel carve-out, product boundary, binding fulfillment, cancelled reserve, and post-expiry provider-outcome checks passed; no provider request was made' AS result;
ROLLBACK;
