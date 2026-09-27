-- Round-18 review fixes: abandoned cleanup skips ambiguously-initialized
-- attempts like interactive cancellation does. `initializing` (provider POST
-- in flight) and `indeterminate` (provider timeout that may hold a
-- transaction) can both still capture, so the worker batch must revert the
-- cancel to a no-op for them exactly as it does for initialized/held
-- attempts — cancelling would release fenced units the capture path owns
-- and strand the order where approval rejects cancelled rows.
CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Cleanup/capture serialization: the worker batch must observe attempt
  -- state under the same order payment lock the capture path holds while
  -- recording, otherwise a capture that commits between this trigger's
  -- state check and the batch commit lands on a cancelled row (approval
  -- rejects cancelled orders after inventory was released). Taking the
  -- lock first forces the in-flight capture to commit first, so the held
  -- exclusion below sees captured_held and reverts to a no-op. Scoped to
  -- the worker cleanup shape so all other writers are unaffected.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current())
  THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || OLD.id::text, 0)
    );
  END IF;
  -- Held/active drafts are excluded from the generic cleanup transition: a
  -- stale unpaid draft whose attempt is initializing, indeterminate,
  -- initialized, captured, held for evidence review, or approved the
  -- shopper's money, or which carries an unresolved or processed refund,
  -- still represents funds in flight. An initialized attempt holds a live
  -- hosted URL the batch cannot void, while initializing/indeterminate
  -- attempts may still capture, so cancelling any of them would release
  -- fenced units the capture path owns and strand the order where
  -- approval rejects cancelled rows. The dedicated cancel RPC enforces
  -- the same exclusions with explicit errors; the multi-row worker batch
  -- must not abort, so revert the cancel to a no-op instead of raising.
  -- Scoped to the worker shape (service_role, no write context, stale) so
  -- protected writers keep their existing behavior.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current())
    AND (
      EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
              WHERE attempt.order_id = OLD.id
                AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved'))
      OR EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
                 JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
                 WHERE attempt.order_id = OLD.id
                   AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed'))
    )
  THEN
    NEW.payment_status := OLD.payment_status;
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault' AND NEW.payment_method = 'uba_redvault'
    AND NEW.payment_status = 'paid'
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND lower(COALESCE(NEW.shipping_status, '')) IN ('pending', 'processing', 'fulfilled', 'shipped', 'out_for_delivery', 'delivered', 'completed')
    AND (to_jsonb(NEW) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ])
    AND private.redvault_approved_completion_durable(NEW.id) THEN
    RETURN NEW;
  END IF;
  -- Abandoned-order cleanup runs as a service_role batch UPDATE over every
  -- stale unpaid order. Without a carve-out, the first stale REDVAULT draft
  -- aborts the whole statement and blocks cleanup for all other orders, so
  -- permit exactly that worker transition: a stale unpaid draft flipped to
  -- cancelled with nothing else changed. Fenced inventory is released
  -- separately through cancel_abandoned_uba_redvault_draft.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND (to_jsonb(NEW) - ARRAY['payment_status', 'updated_at'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['payment_status', 'updated_at'])
  THEN
    RETURN NEW;
  END IF;
  -- Cleanup release cascade (see header comment): the row trigger's
  -- unit/item/tax writes land on the same stale cancelled draft.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault' AND NEW.payment_method = 'uba_redvault'
    AND NEW.payment_status = 'cancelled'
    AND OLD.payment_status IN ('unpaid', 'cancelled')
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND (to_jsonb(NEW) - ARRAY['payment_status', 'updated_at',
      'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount',
      'invoice_issue_date', 'tax_point_date'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['payment_status', 'updated_at',
      'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount',
      'invoice_issue_date', 'tax_point_date'])
  THEN
    RETURN NEW;
  END IF;
  IF (NEW.payment_method = 'uba_redvault' OR (TG_OP = 'UPDATE' AND OLD.payment_method = 'uba_redvault'))
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current()) THEN
    RAISE EXCEPTION 'redvault_order_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_unscoped_redvault_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unscoped_redvault_order() FROM PUBLIC, anon, authenticated, service_role;
