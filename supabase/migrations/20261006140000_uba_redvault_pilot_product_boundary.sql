-- PR #3555 round-3 review follow-up: guard the bound pilot product on every
-- order path.
--
-- The pilot's order/attempt/fulfillment guards all key off REDVAULT
-- application and policy rows, so they engage only when checkout travels
-- the REDVAULT path. The dedicated NGN 100 test product itself was left
-- orderable through normal Paystack, COD, or generic order creation, which
-- never inserts an application row: the fixed pilot user, single-unit
-- restriction, attempt cap, and fulfillment guards would not apply, and the
-- test-only product could be purchased and fulfilled outside the pilot.
--
-- This boundary trigger rejects assigning the bound pilot product to any
-- order line (inserts and product swaps) outside the protected REDVAULT
-- write context that the order-draft RPC establishes, so only the pilot
-- order flow can take the product while it is bound. Column-only updates
-- (quantity, fulfillment data) stay governed by the item-mutation trigger:
-- rejecting them here as well would break the approved-completion
-- fulfillment-data path, which carries no write context by design. When no
-- product is bound (policy.product_id IS NULL) the predicate never matches
-- and normal commerce is unaffected.

CREATE FUNCTION private.guard_uba_redvault_pilot_product_orders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id)
    AND EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
      WHERE policy.product_id = NEW.product_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_write_context AS context
      WHERE context.transaction_id = pg_catalog.txid_current()
    ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_restricted';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_uba_redvault_pilot_product_orders() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_uba_redvault_pilot_product_orders()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_uba_redvault_pilot_product_orders
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_uba_redvault_pilot_product_orders();
