-- An offer exceeding the award must never consume stock or mutate the prize.
UPDATE public.product_offers SET price=101 WHERE id='00000000-0000-0000-0000-000000000011';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
    p_merchant_id=>'00000000-0000-0000-0000-000000000002',
    p_customer_email=>'buyer@example.com', p_customer_name=>'Buyer',
    p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}]',
    p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
 END;
 IF NOT rejected OR (SELECT stock_quantity FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011')<>5
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009'
    AND order_item_id='00000000-0000-0000-0000-000000000006' AND status='reserved') THEN
  RAISE EXCEPTION 'overpriced offer must not mutate the prize or its stock';
 END IF;
END $$;
-- A sold-at timestamp on an apparently reserved prize is unsafe to reopen.
UPDATE public.product_offers SET price=50 WHERE id='00000000-0000-0000-0000-000000000011';
UPDATE public.variant_inventory SET sold_at=now() WHERE id='00000000-0000-0000-0000-000000000009';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
    p_merchant_id=>'00000000-0000-0000-0000-000000000002',
    p_customer_email=>'buyer@example.com', p_customer_name=>'Buyer',
    p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}]',
    p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected:=true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009'
   AND status='reserved' AND sold_at IS NOT NULL AND order_item_id='00000000-0000-0000-0000-000000000006') THEN
  RAISE EXCEPTION 'sold prize must remain attached for manual review';
 END IF;
END $$;
