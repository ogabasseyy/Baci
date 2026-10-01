-- Round-35 review fixes.
-- P1 (quantity-managed fulfillment): the order_items trigger installed by
-- 20260913090600 recomputed fulfillmentQuantity solely from reserved
-- variant_inventory rows on EVERY fulfillment_data update of a REDVAULT
-- line. Quantity-managed lines have no such rows, so after
-- release_redvault_refund_quantity_units wrote the correct surviving
-- count, the trigger immediately overwrote it with 0 and the shipping
-- builders omitted all remaining units from the provider request. The
-- trigger is obsolete: every serialized writer already persists the
-- reserved count itself, and variant_inventory changes recompute through
-- the dedicated _from_inventory trigger from 20260913090700. Drop the
-- order_items trigger and its function; the variant_inventory trigger is
-- untouched.
DROP TRIGGER IF EXISTS persist_redvault_surviving_shipment_quantity
  ON public.order_items;
DROP FUNCTION IF EXISTS private.persist_redvault_surviving_shipment_quantity();
