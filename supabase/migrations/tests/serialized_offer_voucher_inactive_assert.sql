UPDATE public.product_offers SET status='inactive' WHERE id='00000000-0000-0000-0000-000000000011';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
    p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com', p_customer_name=>'Buyer',
    p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
    p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected:=true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved') THEN
  RAISE EXCEPTION 'inactive offer must reject without consuming the award';
 END IF;
END $$;
