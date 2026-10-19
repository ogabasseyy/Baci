-- redvault-private-pilot-full-schema-postreserve.sql
-- Part 4/6: post-reservation guards - pre-approval fulfillment blocks,
-- savings-redemption block, shipment-insert block, and the proof-replay
-- plus reservation-binding assertions.
--
-- Runs concatenated after the reservations part inside the same
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- expects the session-owner role (reservations ends with RESET ROLE);
-- do not run standalone.

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- Satisfy the unscoped-write trigger so these probes isolate the pilot
  -- guard deterministically regardless of trigger firing order. The context
  -- row is removed at the end of this block, mirroring the protected RPCs.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  BEGIN
    UPDATE public.orders SET shipping_status = 'shipped' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'preapproval_pilot_fulfillment_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    UPDATE public.orders SET tracking_number = 'RV-PILOT-PROBE' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'preapproval_pilot_tracking_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  customer_id uuid;
  goal_id uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  INSERT INTO public.customers(merchant_id, email)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'pilot-saver@example.test')
  RETURNING id INTO customer_id;
  INSERT INTO public.customer_savings_goals(merchant_id, customer_id, product_id, title, target_amount, contribution_amount, contribution_frequency)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', customer_id, fixture.product_id, 'pilot probe', 100, 10, 'weekly')
  RETURNING id INTO goal_id;
  BEGIN
    INSERT INTO public.customer_savings_redemptions(goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (goal_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', customer_id, fixture.order_id, 5, 'pilot-redemption-probe');
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_wallet_or_savings_credit_blocked' THEN
    RAISE EXCEPTION 'postreserve_pilot_redemption_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  BEGIN
    INSERT INTO public.shipments(
      order_id, merchant_id, provider, status, sender_address, receiver_address, items
    ) VALUES (
      fixture.order_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'GIGL', 'pending',
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'active_pilot_shipment_insert_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  replay_count integer;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  SELECT count(*) INTO replay_count
  FROM private.redvault_discount_proof_replay AS proof
  JOIN private.uba_redvault_applications AS application ON application.proof_id = proof.proof_id
  WHERE application.order_id = fixture.order_id
    AND proof.order_id = fixture.order_id
    AND proof.quote_version_id = application.quote_version_id;
  IF replay_count <> 1 THEN RAISE EXCEPTION 'protected_create_did_not_attach_proof'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    WHERE policy.enabled IS TRUE AND policy.reserved_order_id = fixture.order_id
      AND policy.reserved_attempt_id = fixture.attempt_id
  ) THEN RAISE EXCEPTION 'protected_reservation_binding_missing'; END IF;
END;
$$;

