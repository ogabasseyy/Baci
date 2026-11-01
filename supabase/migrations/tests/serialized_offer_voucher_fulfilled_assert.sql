UPDATE public.orders SET shipping_status='shipped',shipped_at=now()
 WHERE id='00000000-0000-0000-0000-000000000005';
DO $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002',p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected:=true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved') THEN
  RAISE EXCEPTION 'fulfilled prize must not be reassigned';
 END IF;
END $$;
