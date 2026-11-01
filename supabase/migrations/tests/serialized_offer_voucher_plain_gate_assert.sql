-- A plain serialized quiz prize must remain redeemable while the new offer
-- feature is gated off, even if its input includes the prize condition.
CREATE OR REPLACE FUNCTION public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
DELETE FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011';
DO $$ BEGIN
 PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
  p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com', p_customer_name=>'Buyer',
  p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
  p_user_id=>'00000000-0000-0000-0000-000000000004');
 IF NOT EXISTS (SELECT 1 FROM public.quiz_awards award JOIN public.variant_inventory unit
   ON unit.order_item_id=award.reserved_order_item_id WHERE award.id='00000000-0000-0000-0000-000000000008'
   AND award.status='claimed' AND unit.id='00000000-0000-0000-0000-000000000009' AND unit.status='reserved') THEN
  RAISE EXCEPTION 'plain prize must preserve its original reserved unit';
 END IF;
END $$;
