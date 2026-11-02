-- Provider-confirmed GIGL cancellations, seen only through the trusted
-- tracking apply path, refund the booked merchant-wallet charge exactly once,
-- so the cancellation persists instead of failing forever with 55P03
-- 'active_merchant_shipping_charge'. Owner scope (2026-11-02): only a cancel
-- GIG reports before pickup is refunded; later ones still raise 55P03 for
-- manual handling. private.prevent_active_gigl_shipping_cancellation is
-- unchanged, so every other cancellation writer is still blocked. No customer
-- refund.
--
-- Merchants can write shipments.status and tracking_number, and can bind a
-- charge to a shipment row they inserted, so neither proves anything on its
-- own. A refund also needs GIG's own timeline, which only the tracking worker
-- records (public.shipment_tracking_events, with GIG's event times): GIG
-- created the waybill while this charge's submission was in flight, nothing
-- GIG reported for it predates that submission or shows a pickup or later
-- scan, and GIG cancelled it afterwards. Otherwise nothing is refunded and
-- the guard keeps raising 55P03.

-- 1. Fixed booked waybill: stamp provider_reference when a charge becomes
--    booked (complete_merchant_shipping_charge leaves it NULL). UPDATE-only:
--    charges are never inserted booked. Later tracking_number edits cannot
--    move the stamp, and one waybill backs at most one charge.
CREATE FUNCTION private.stamp_booked_gigl_charge_waybill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_waybill text;
BEGIN
  IF NEW.status = 'booked'
     AND OLD.status IS DISTINCT FROM 'booked'
     AND NEW.provider_reference IS NULL
     AND NEW.shipment_id IS NOT NULL THEN
    SELECT nullif(btrim(shipment.tracking_number), '')
    INTO v_waybill
    FROM public.shipments AS shipment
    WHERE shipment.id = NEW.shipment_id
      AND shipment.merchant_id = NEW.merchant_id
      AND shipment.order_id = NEW.order_id
      AND shipment.provider = 'GIGL';
    IF v_waybill IS NOT NULL THEN
      -- Serialize stamps of one waybill. If a booked or refunded charge
      -- already holds it, leave this charge unstamped (never refunded
      -- automatically) instead of failing the booking.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('gigl-charge-waybill:' || v_waybill, 0)
      );
      IF NOT EXISTS (
        SELECT 1
        FROM public.merchant_shipping_charges AS other
        WHERE other.provider_reference = v_waybill
          AND other.status IN ('booked', 'refunded')
          AND other.id <> NEW.id
      ) THEN
        NEW.provider_reference := v_waybill;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_booked_gigl_charge_waybill()
  FROM PUBLIC, anon, authenticated, service_role;

-- Only BEFORE trigger on the table; never changes status, so the AFTER
-- enqueue_gigl_wallet_shipping_charge_review trigger behaves as before.
CREATE TRIGGER stamp_booked_gigl_charge_waybill
BEFORE UPDATE OF status ON public.merchant_shipping_charges
FOR EACH ROW EXECUTE FUNCTION private.stamp_booked_gigl_charge_waybill();

-- 2. One waybill backs at most one booked or refunded charge (production has
--    one charge row, so the build lock is brief).
CREATE UNIQUE INDEX merchant_shipping_charges_gigl_waybill_once_idx
  ON public.merchant_shipping_charges (provider_reference)
  WHERE provider_reference IS NOT NULL
    AND status IN ('booked', 'refunded');

-- 3. Guarded backfill of existing booked charges (production: exactly one,
--    6d195a34, waybill 1349639673, whose MCRT the worker recorded 3.5 s after
--    the submission began). Stamp only a waybill GIG created during the
--    charge's submission, with no earlier GIG history, that no other charge
--    holds. No status change, so neither trigger fires.
WITH candidate AS (
  SELECT charge.id, btrim(shipment.tracking_number) AS waybill
  FROM public.merchant_shipping_charges AS charge
  JOIN public.shipments AS shipment
    ON shipment.id = charge.shipment_id
   AND shipment.merchant_id = charge.merchant_id
   AND shipment.order_id = charge.order_id
   AND shipment.provider = 'GIGL'
  WHERE charge.status = 'booked'
    AND charge.provider_reference IS NULL
    AND charge.provider_submitting_at IS NOT NULL
    AND nullif(btrim(shipment.tracking_number), '') IS NOT NULL
    AND shipment.tracking_number = shipment.provider_shipment_id
    AND EXISTS (
      SELECT 1
      FROM public.shipment_tracking_events AS created
      WHERE created.shipment_id = shipment.id
        AND created.provider = 'GIGL'
        AND created.tracking_number = btrim(shipment.tracking_number)
        AND created.normalized_status = 'booked'
        AND created.occurred_at
          >= charge.provider_submitting_at - interval '5 minutes'
        AND created.occurred_at
          <= charge.provider_submitting_at + interval '15 minutes'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.shipment_tracking_events AS earlier
      WHERE earlier.shipment_id = shipment.id
        AND earlier.tracking_number = btrim(shipment.tracking_number)
        AND earlier.occurred_at
          < charge.provider_submitting_at - interval '5 minutes'
    )
)
UPDATE public.merchant_shipping_charges AS charge
SET provider_reference = candidate.waybill,
    updated_at = now()
FROM candidate
WHERE charge.id = candidate.id
  AND NOT EXISTS (
    SELECT 1
    FROM candidate AS twin
    WHERE twin.waybill = candidate.waybill
      AND twin.id <> candidate.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS other
    WHERE other.provider_reference = candidate.waybill
      AND other.status IN ('booked', 'refunded')
  );

-- 4. Exactly-once backstop: at most one provider-cancellation refund per
--    charge (wallet_transactions has 155 rows; the build lock is brief).
CREATE UNIQUE INDEX wallet_transactions_gigl_charge_refund_once_idx
  ON public.wallet_transactions ((metadata ->> 'merchant_shipping_charge_id'))
  WHERE type = 'refund'
    AND source_type = 'gigl_shipping'
    AND (metadata ->> 'merchant_shipping_charge_id') IS NOT NULL;

-- 5. Internal refund step, no API grant. Reached only from
--    apply_gigl_tracking_result (service_role-only, monitor lease required).
CREATE FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_order_id uuid,
  p_prior_shipment_status text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  -- GIG clock tolerance, and how long a submission stays in flight (the
  -- staleness window reserve/refund use for provider_submitting charges).
  v_clock_skew constant interval := interval '5 minutes';
  v_submission_window constant interval := interval '15 minutes';
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_event_key text;
  v_raw_status text;
  v_occurred_at timestamptz;
  v_wallet_id uuid;
  v_balance numeric;
  v_transaction uuid;
  v_rows integer;
  v_refunded integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'gigl_provider_cancellation_refund_requires_tracking_apply'
      USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RETURN 0; -- orderless repair pickup: no merchant-wallet charge exists
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.shipment_tracking_monitors AS monitor
    WHERE monitor.shipment_id = p_shipment_id
      AND monitor.tracking_epoch_id = p_tracking_epoch_id
      AND monitor.order_id = p_order_id
      AND monitor.locked_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'gigl_provider_cancellation_refund_requires_monitor_lease'
      USING ERRCODE = '42501';
  END IF;
  -- Only cancellations before pickup are refunded automatically. Later ones
  -- stay blocked by the unchanged guard (55P03) for manual handling. The
  -- stored status can be stale or merchant-written, so the loop below also
  -- requires GIG's events to show no pickup.
  IF p_prior_shipment_status IS NULL
     OR p_prior_shipment_status NOT IN ('pending', 'booked', 'pickup_scheduled') THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.shipment_id = p_shipment_id
      AND charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RETURN 0; -- customer-checkout GIG, already refunded, or a re-apply
  END IF;

  -- Same lock order as reserve_merchant_shipping_charge:
  -- advisory -> order -> charge -> wallet.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  PERFORM 1 FROM public.orders AS o WHERE o.id = p_order_id FOR UPDATE;

  FOR v_charge IN
    SELECT charge.*
    FROM public.merchant_shipping_charges AS charge
    JOIN public.shipments AS shipment
      ON shipment.id = charge.shipment_id
     AND shipment.merchant_id = charge.merchant_id
     AND shipment.order_id = charge.order_id
     AND shipment.provider = 'GIGL'
    WHERE charge.shipment_id = p_shipment_id
      AND charge.order_id = p_order_id
      AND charge.status = 'booked'
      AND charge.provider_reference IS NOT NULL
    ORDER BY charge.id
    FOR UPDATE OF charge
  LOOP
    -- Each check below that fails refunds nothing, so the guard keeps
    -- blocking. Events from earlier epochs and from this apply call count.
    CONTINUE WHEN v_charge.provider_submitting_at IS NULL;
    -- (a) GIG created the stamped waybill while this charge's submission was
    --     in flight.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM public.shipment_tracking_events AS created
      WHERE created.shipment_id = p_shipment_id
        AND created.provider = 'GIGL'
        AND created.tracking_number = v_charge.provider_reference
        AND created.normalized_status = 'booked'
        AND created.occurred_at
          >= v_charge.provider_submitting_at - v_clock_skew
        AND created.occurred_at
          <= v_charge.provider_submitting_at + v_submission_window
    );
    -- (b) Nothing GIG reported for that waybill predates the submission (a
    --     reused or older waybill), and (c) nothing shows a pickup or later
    --     scan.
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM public.shipment_tracking_events AS history
      WHERE history.shipment_id = p_shipment_id
        AND history.provider = 'GIGL'
        AND history.tracking_number = v_charge.provider_reference
        AND (
          history.occurred_at < v_charge.provider_submitting_at - v_clock_skew
          OR history.normalized_status NOT IN (
            'pending', 'booked', 'pickup_scheduled', 'cancelled'
          )
        )
    );
    -- (d) This worker epoch recorded GIG's cancellation of that waybill after
    --     the submission.
    SELECT event.provider_event_key, event.raw_status, event.occurred_at
    INTO v_event_key, v_raw_status, v_occurred_at
    FROM public.shipment_tracking_events AS event
    WHERE event.shipment_id = p_shipment_id
      AND event.tracking_epoch_id = p_tracking_epoch_id
      AND event.provider = 'GIGL'
      AND event.normalized_status = 'cancelled'
      AND event.tracking_number = v_charge.provider_reference
      AND event.occurred_at >= v_charge.provider_submitting_at - v_clock_skew
    ORDER BY event.occurred_at DESC, event.id
    LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    -- Refund exactly what was debited.
    IF NOT EXISTS (
      SELECT 1
      FROM public.wallet_transactions AS debit
      WHERE debit.id = v_charge.debit_transaction_id
        AND debit.merchant_id = v_charge.merchant_id
        AND debit.type = 'debit'
        AND debit.status = 'completed'
        AND debit.source_type = 'gigl_shipping'
        AND debit.source_id = v_charge.order_id
        AND debit.amount = v_charge.charged_amount
    ) THEN
      RAISE EXCEPTION 'gigl_wallet_charge_debit_mismatch' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.merchant_wallets AS wallet
    SET available_balance = wallet.available_balance + v_charge.charged_amount,
        updated_at = now()
    WHERE wallet.merchant_id = v_charge.merchant_id
    RETURNING wallet.id, wallet.available_balance INTO v_wallet_id, v_balance;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merchant_wallet_missing' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.wallet_transactions (
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status, metadata
    ) VALUES (
      v_wallet_id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
      v_balance, 'gigl_shipping', v_charge.order_id,
      'GIGL shipping refund: shipment cancelled by GIG', 'completed',
      jsonb_build_object(
        'reason_code', 'PROVIDER_CANCELLED_AFTER_BOOKING',
        'merchant_shipping_charge_id', v_charge.id,
        'shipment_id', p_shipment_id,
        'waybill', v_charge.provider_reference,
        'tracking_epoch_id', p_tracking_epoch_id,
        'provider_event_key', v_event_key,
        'provider_raw_status', v_raw_status,
        'provider_event_occurred_at', v_occurred_at,
        'prior_shipment_status', p_prior_shipment_status,
        'provider_cost', v_charge.provider_cost,
        'platform_margin', v_charge.platform_margin
      )
    )
    RETURNING id INTO v_transaction;

    UPDATE public.merchant_shipping_charges AS charge
    SET status = 'refunded',
        refund_transaction_id = v_transaction,
        failure_code = 'PROVIDER_CANCELLED_AFTER_BOOKING',
        refunded_at = now(),
        updated_at = now()
    WHERE charge.id = v_charge.id
      AND charge.status = 'booked';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'gigl_wallet_charge_refund_race' USING ERRCODE = '40001';
    END IF;
    v_refunded := v_refunded + 1;
  END LOOP;
  RETURN v_refunded;
END;
$$;
REVOKE ALL ON FUNCTION private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- 6. In-place patch of the LIVE apply function (20260905140000 pattern), so
--    the 20260904190550 and 20260905140000 hardenings survive. CREATE OR
--    REPLACE keeps the owner and the postgres/service_role-only grants.
DO $migration$
DECLARE
  v_fn constant regprocedure :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'::regprocedure;
  v_anchor constant text :=
    E'  SELECT count(*) INTO v_inserted_events FROM inserted_events;\n'
    || E'  UPDATE public.shipments AS shipment\n';
  v_replacement constant text :=
    E'  SELECT count(*) INTO v_inserted_events FROM inserted_events;\n'
    || E'  IF v_effective_status = ''cancelled'' AND p_status = ''cancelled'' THEN\n'
    || E'    PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(\n'
    || E'      p_shipment_id, p_tracking_epoch_id, v_order_id, v_current_status\n'
    || E'    );\n'
    || E'  END IF;\n'
    || E'  UPDATE public.shipments AS shipment\n';
  v_original text;
  v_patched text;
BEGIN
  v_original := pg_catalog.pg_get_functiondef(v_fn);
  IF strpos(v_original, 'refund_gigl_wallet_charge_on_provider_cancellation') > 0 THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result already refunds provider cancellations';
  END IF;
  IF length(v_original) - length(replace(v_original, v_anchor, ''))
     <> length(v_anchor) THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result anchor must occur exactly once';
  END IF;
  v_patched := replace(v_original, v_anchor, v_replacement);
  IF v_patched = v_original
     OR strpos(v_patched, 'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(') = 0
     OR strpos(v_patched, 'PERFORM private.refund_gigl_wallet_charge_on_provider_cancellation(')
       >= strpos(v_patched, E'  UPDATE public.shipments AS shipment\n') THEN
    RAISE EXCEPTION 'provider-cancellation refund must precede the shipments update';
  END IF;
  EXECUTE v_patched;
END;
$migration$;

-- 7. Catalog assertions (a denied EXECUTE cannot be trapped on the replay
--    image, so privileges are checked in the catalog, never by calling).
DO $assert$
DECLARE
  v_helper constant text :=
    'private.refund_gigl_wallet_charge_on_provider_cancellation(uuid, uuid, uuid, text)';
  v_stamp constant text := 'private.stamp_booked_gigl_charge_waybill()';
  v_apply constant text :=
    'public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)';
  v_fn text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[v_helper, v_stamp] LOOP
    FOREACH v_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'gigl_tracking_worker'
    ] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not execute %', v_role, v_fn;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid IN (v_helper::regprocedure, v_stamp::regprocedure)
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute provider-cancellation helpers';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_apply, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_apply, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_apply, 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_gigl_tracking_result privileges drifted';
  END IF;
END;
$assert$;
