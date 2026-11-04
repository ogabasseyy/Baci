-- Provider-confirmed GIGL cancellations, seen only through the trusted
-- tracking apply path, refund the booked merchant-wallet charge exactly once,
-- so the cancellation persists instead of failing forever with 55P03
-- 'active_merchant_shipping_charge'. Owner scope (2026-11-02): only a cancel
-- GIG reports before pickup is refunded; later ones still raise 55P03 for
-- manual handling. private.prevent_active_gigl_shipping_cancellation is
-- unchanged, so every other cancellation writer is still blocked. No customer
-- refund.
--
-- Three ordered migrations:
--   20261102053300 (this file) waybill stamp, one-waybill-per-charge index,
--                  guarded backfill, refund-once index
--   20261102053310 private refund helper
--   20261102053320 in-place patch of apply_gigl_tracking_result + asserts
--
-- Merchants can write shipments.status and tracking_number, can bind a
-- charge to a shipment row they inserted (recover RPC, no attempt token),
-- can create and cancel waybills in their own GIG account, and can get
-- Baci-account waybills created and cancelled for their other orders, so
-- none of that proves anything. A refund needs (1) a waybill stamped only
-- by the server's own booking: complete_merchant_shipping_charge (which
-- needs the server-held attempt token) on the shipment row the server just
-- inserted, untouched since; (2) GIG's own timeline, which only the
-- tracking worker records (public.shipment_tracking_events): GIG created
-- the waybill while this charge's submission was in flight, nothing
-- predates that or shows a pickup or later scan, and GIG cancelled it
-- afterwards; and (3) the worker's account attestation in that same apply
-- call: GIG's preshipment record for the waybill names Baci's own GIG
-- account. Otherwise nothing is refunded and the guard keeps raising 55P03.

-- 1. Fixed booked waybill: stamp provider_reference when a charge becomes
--    booked (complete_merchant_shipping_charge leaves it NULL). UPDATE-only:
--    charges are never inserted booked. Later tracking_number edits cannot
--    move the stamp, and one waybill backs at most one charge. Stamp only
--    the server's own booking:
--    - provider_submitting -> booked with the attempt token digest unchanged
--      is complete(), which needs the server-held token. recover() rotates
--      the digest to the caller's token, so a charge it binds (crash
--      recovery, or a merchant binding a decoy row) stays unstamped and is
--      never refunded automatically.
--    - the shipment's tracking_snapshot_version is still 1: the row has not
--      changed provider, waybill, provider id or status since it was
--      inserted (private.bump_shipment_tracking_snapshot_version bumps it on
--      any such write and authenticated cannot lower it), so a merchant who
--      rewrites the server's row before complete() runs gets no stamp.
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
     AND OLD.status = 'provider_submitting'
     AND NEW.attempt_token_digest IS NOT DISTINCT FROM OLD.attempt_token_digest
     AND NEW.provider_reference IS NULL
     AND NEW.shipment_id IS NOT NULL THEN
    SELECT nullif(btrim(shipment.tracking_number), '')
    INTO v_waybill
    FROM public.shipments AS shipment
    WHERE shipment.id = NEW.shipment_id
      AND shipment.merchant_id = NEW.merchant_id
      AND shipment.order_id = NEW.order_id
      AND shipment.provider = 'GIGL'
      AND shipment.tracking_snapshot_version = 1;
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

-- 2. Guarded backfill of existing booked charges (production: exactly one,
--    6d195a34, waybill 1349639673, whose MCRT the worker recorded 3.5 s after
--    the submission began; complete() ran 0.1 s after the server inserted
--    the shipment). Stamp only a charge completed within a minute of its
--    shipment row's insert during the submission (the server's own
--    insert-then-complete, not a later recover), on a waybill GIG created
--    during the submission, with no earlier GIG history, that no other
--    charge holds. Each candidate waybill is stamped under the same
--    advisory lock the stamp trigger takes, with the charge row locked and
--    its holders re-checked under the lock, so a live booking during the
--    deploy cannot race it; the unique index below is built only afterwards.
--    No status change, so neither trigger fires. The stamp alone refunds
--    nothing: the refund also needs the worker's account attestation.
DO $backfill$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
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
        AND shipment.created_at >= charge.provider_submitting_at
        AND shipment.created_at
          <= charge.provider_submitting_at + interval '15 minutes'
        AND charge.completed_at >= shipment.created_at
        AND charge.completed_at <= shipment.created_at + interval '1 minute'
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
    SELECT candidate.id, candidate.waybill
    FROM candidate
    WHERE (
      SELECT count(*) FROM candidate AS twin
      WHERE twin.waybill = candidate.waybill
    ) = 1
    ORDER BY candidate.waybill, candidate.id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('gigl-charge-waybill:' || v_row.waybill, 0)
    );
    PERFORM 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.id = v_row.id
      AND charge.status = 'booked'
      AND charge.provider_reference IS NULL
    FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges AS other
      WHERE other.provider_reference = v_row.waybill
        AND other.status IN ('booked', 'refunded')
        AND other.id <> v_row.id
    );
    UPDATE public.merchant_shipping_charges AS charge
    SET provider_reference = v_row.waybill,
        updated_at = now()
    WHERE charge.id = v_row.id;
  END LOOP;
END;
$backfill$;

-- 3. One waybill backs at most one booked or refunded charge (production has
--    one charge row, so the build lock is brief).
CREATE UNIQUE INDEX merchant_shipping_charges_gigl_waybill_once_idx
  ON public.merchant_shipping_charges (provider_reference)
  WHERE provider_reference IS NOT NULL
    AND status IN ('booked', 'refunded');

-- 4. Exactly-once backstop: at most one provider-cancellation refund per
--    charge (wallet_transactions has 155 rows; the build lock is brief).
CREATE UNIQUE INDEX wallet_transactions_gigl_charge_refund_once_idx
  ON public.wallet_transactions ((metadata ->> 'merchant_shipping_charge_id'))
  WHERE type = 'refund'
    AND source_type = 'gigl_shipping'
    AND (metadata ->> 'merchant_shipping_charge_id') IS NOT NULL;
