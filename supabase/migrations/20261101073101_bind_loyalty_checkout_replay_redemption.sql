-- Issue #3689: preserve the original redemption identity on order replay.
-- Patch the installed wrapper without changing its signature or grants.
DO $repair$
DECLARE
 definition text;
 old_block text := $old$  -- REPLAY: the order already existed; the first call already enforced
  -- policy and claimed the code, so a legitimate retry returns as-is
  -- WITHOUT re-checking or re-marking — but only while that claim is
  -- still live. A payment-only cancellation (mark_abandoned_orders)
  -- neither blocks the underlying RPC's replay (it reopens the order
  -- as unpaid) nor keeps the claim: the release trigger frees the
  -- code, so returning success here would leave the reopened order's
  -- discount in place while another order claims the same code. A
  -- replay whose claim was released (or whose order is cancelled)
  -- falls through to the FRESH claim below and re-earns the code
  -- under full policy.
$old$;
 new_block text := $new$  -- A replay is valid only for the original live claim. An unused or
  -- released redemption must never fall through to the fresh-claim path:
  -- that would consume a second code for the same persisted discount.
  IF v_order.idempotency_replayed
     AND (NOT v_redemption.used
       OR v_redemption.used_on_order_id IS DISTINCT FROM v_order.id) THEN
    RAISE EXCEPTION 'checkout_idempotency_conflict';
  END IF;
  -- Identical retries preserve the already accepted issuance policy.
$new$;
BEGIN
 SELECT pg_catalog.pg_get_functiondef(
 'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::regprocedure)
 INTO definition;
 IF (length(definition)-length(replace(definition,old_block,'')))/length(old_block) <> 1 THEN
  RAISE EXCEPTION 'loyalty replay repair source shape changed';
 END IF;
 EXECUTE replace(definition,old_block,new_block);
END;
$repair$;
