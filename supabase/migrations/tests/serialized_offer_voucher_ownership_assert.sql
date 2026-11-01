-- A caller must not consume another customer's reserved prize or offer stock.
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'other@example.com', p_customer_name=>'Other',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000099');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'quiz_voucher_award_not_found' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved' AND order_item_id='00000000-0000-0000-0000-000000000006')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000010' AND status='available' AND order_item_id IS NULL)
  OR EXISTS (SELECT 1 FROM private.serialized_offer_order_items) THEN
  RAISE EXCEPTION 'unauthorized voucher must leave the award and inventory unchanged';
 END IF;
END $$;
