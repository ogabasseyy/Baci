-- A reserved prize line is not currently allowed to change its purchased
-- offer identity. Voucher transfer must preserve that rule for direct writes.
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  UPDATE public.order_items
  SET offer_line=true, product_offer_id='00000000-0000-0000-0000-000000000011'
  WHERE id='00000000-0000-0000-0000-000000000006';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'order_items.offer_line is immutable%' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected OR NOT EXISTS (
   SELECT 1 FROM public.quiz_awards award
   JOIN public.order_items item ON item.id=award.reserved_order_item_id
   JOIN public.variant_inventory unit ON unit.order_item_id=item.id
   WHERE award.id='00000000-0000-0000-0000-000000000008'
     AND award.status='approved' AND item.offer_line IS NOT TRUE
     AND item.product_offer_id IS NULL AND unit.status='reserved'
 ) THEN
  RAISE EXCEPTION 'direct offer reassignment must fail without changing the prize';
 END IF;
END $$;
