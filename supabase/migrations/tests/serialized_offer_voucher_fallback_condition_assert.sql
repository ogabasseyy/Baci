-- The fallback order contains an ordinary product line before the selected
-- offer line. An omitted ordinal must not bind the voucher to the wrong line.
ALTER TABLE public.order_items ADD COLUMN quiz_award_id uuid;
ALTER TABLE public.order_items ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.order_items ADD COLUMN line_id integer;
UPDATE public.quiz_awards SET reserved_order_id=NULL,reserved_order_item_id=NULL
 WHERE id='00000000-0000-0000-0000-000000000008';
CREATE TABLE private.test_voucher_fallback_call (items jsonb);
CREATE FUNCTION private.create_storefront_order(
 p_merchant_id uuid,p_customer_email text,p_customer_name text,p_items jsonb,p_customer_phone text,
 p_shipping_fee numeric,p_discount_amount numeric,p_tax_amount numeric,p_payment_method text,
 p_payment_status text,p_shipping_status text,p_shipping_address jsonb,p_source text,p_notes text,
 p_ad_tracking jsonb,p_selected_quote_id uuid,p_shipping_provider text,p_tracking_number text,
 p_user_id uuid,p_tax_basis text,p_gift_wrapping_fee numeric,p_expected_total numeric
) RETURNS TABLE(id uuid,order_number text,tracking_token text,subtotal numeric,shipping_fee numeric,
 discount_amount numeric,tax_amount numeric,total numeric,customer_id uuid,customer_email text,
 customer_name text,customer_phone text,payment_status text,shipping_status text,payment_method text,
 shipping_address jsonb,merchant_id uuid,tax_basis text,gift_wrapping_fee numeric)
LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO private.test_voucher_fallback_call VALUES(p_items);
 INSERT INTO public.orders(id,merchant_id,customer_id) VALUES
  ('00000000-0000-0000-0000-000000000105',p_merchant_id,'00000000-0000-0000-0000-000000000003');
 INSERT INTO public.order_items(id,order_id,product_id,condition,line_id) VALUES
  ('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000007','used',1);
 INSERT INTO public.order_items(id,order_id,product_id,condition,line_id,offer_id,product_offer_id) VALUES
  ('00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000007','used',2,
   '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011');
 RETURN QUERY SELECT '00000000-0000-0000-0000-000000000105'::uuid,'ORDER'::text,'TOKEN'::text,0::numeric,
  0::numeric,0::numeric,0::numeric,0::numeric,'00000000-0000-0000-0000-000000000003'::uuid,
  p_customer_email,p_customer_name,p_customer_phone,p_payment_status,p_shipping_status,p_payment_method,
  p_shipping_address,p_merchant_id,p_tax_basis,p_gift_wrapping_fee;
END $$;
DO $$ BEGIN
 PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
  p_merchant_id=>'00000000-0000-0000-0000-000000000002',p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
  p_items=>'[{"product_id":"00000000-0000-0000-0000-000000000007","condition":"used"},{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
  p_user_id=>'00000000-0000-0000-0000-000000000004');
 IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000107'
   AND quiz_award_id='00000000-0000-0000-0000-000000000008' AND product_offer_id='00000000-0000-0000-0000-000000000011')
  OR EXISTS (SELECT 1 FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000106' AND quiz_award_id IS NOT NULL)
  OR NOT EXISTS (SELECT 1 FROM private.test_voucher_fallback_call WHERE items->1->>'condition'='used' AND items->1->>'offer_id' IS NULL) THEN
  RAISE EXCEPTION 'voucher fallback must forward and bind the selected offer line';
 END IF;
END $$;
