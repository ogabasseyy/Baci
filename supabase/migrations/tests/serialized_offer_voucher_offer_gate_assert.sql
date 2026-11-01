CREATE OR REPLACE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
DO $$
DECLARE entry jsonb; rejected boolean;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements('[{"offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"},{"condition":"used"}]'::jsonb)
 LOOP
  rejected:=false;
  BEGIN
   PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
    p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
    p_items=>jsonb_build_array(entry || '{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007"}'::jsonb),
    p_user_id=>'00000000-0000-0000-0000-000000000004');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'gated offer voucher must reject'; END IF;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved')
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved') THEN
  RAISE EXCEPTION 'gated offer must leave the original award and unit unchanged';
 END IF;
END $$;
