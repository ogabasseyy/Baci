UPDATE public.quiz_awards SET variant_id='00000000-0000-0000-0000-000000000012'
 WHERE id='00000000-0000-0000-0000-000000000008';
DO $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002',p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved') THEN
  RAISE EXCEPTION 'condition-only offer must reject a mismatched award variant';
 END IF;
END $$;
