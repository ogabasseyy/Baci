-- A legacy offer snapshot with deleted foreign keys is not an untouched prize.
ALTER TABLE public.order_items DISABLE TRIGGER guard_order_offer;
UPDATE public.order_items SET offer_labels_snapshotted=true,offer_grade='historical'
 WHERE id='00000000-0000-0000-0000-000000000006';
ALTER TABLE public.order_items ENABLE TRIGGER guard_order_offer;
DO $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002',p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
 END;
 IF NOT rejected OR (SELECT stock_quantity FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011')<>5
  OR NOT EXISTS (SELECT 1 FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006'
    AND offer_labels_snapshotted IS TRUE AND offer_grade='historical') THEN
  RAISE EXCEPTION 'historical offer identity must never be overwritten';
 END IF;
END $$;
