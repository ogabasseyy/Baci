-- Give the M12 order-item offer identity the same delete lifecycle as its
-- siblings: order_items.product_id and order_items.variant_id are both
-- ON DELETE SET NULL so deleting a product (or variant) preserves order
-- history. M12's offer FK used the default NO ACTION, so deleting a product
-- with a previously ordered condition offer fails: the product delete
-- cascades to product_offers, but the referenced offer rows cannot be
-- removed while order_items rows point at them, and
-- DELETE /api/products/[id] surfaces the violation as a generic 500.
-- Recreate the FK as ON DELETE SET NULL; reruns converge.
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_offer_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_offer_id_fkey
  FOREIGN KEY (offer_id) REFERENCES public.product_offers (id)
  ON DELETE SET NULL;
