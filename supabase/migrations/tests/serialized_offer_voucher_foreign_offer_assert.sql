-- Owning the award must not confer access to another merchant's offer.
INSERT INTO public.products VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022','serialized_strict');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000020',true,'inherit');
INSERT INTO public.product_offers VALUES ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000020','used','active');
INSERT INTO public.variant_inventory VALUES ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000023',NULL,NULL,'available');
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000023","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM <> 'quiz_voucher_offer_invalid' THEN RAISE; END IF;
  rejected := true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved' AND order_item_id='00000000-0000-0000-0000-000000000006')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000024' AND status='available' AND order_item_id IS NULL)
  OR EXISTS (SELECT 1 FROM private.serialized_offer_order_items) THEN
  RAISE EXCEPTION 'foreign offer must be rejected without changing award or inventory';
 END IF;
END $$;
