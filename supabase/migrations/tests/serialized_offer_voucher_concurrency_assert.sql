CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO public.orders(id,merchant_id,customer_id,payment_status,payment_method,shipping_status)
VALUES ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','paid','quiz_award','pending');
INSERT INTO public.order_items(id,order_id,product_id,condition)
VALUES ('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000105',
 '00000000-0000-0000-0000-000000000007','used');
INSERT INTO public.quiz_awards(id,event_id,customer_id,amount,reserved_order_id,reserved_order_item_id,status,product_id,condition)
VALUES ('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000003',100,'00000000-0000-0000-0000-000000000105',
 '00000000-0000-0000-0000-000000000106','approved','00000000-0000-0000-0000-000000000007','used');
INSERT INTO public.variant_inventory(id,merchant_id,variant_id,status,order_id,order_item_id)
VALUES ('00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000012','reserved','00000000-0000-0000-0000-000000000105',
 '00000000-0000-0000-0000-000000000106');
UPDATE public.product_offers SET stock_quantity=1 WHERE id='00000000-0000-0000-0000-000000000011';
CREATE FUNCTION private.test_concurrent_voucher(p_award uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
  p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
  p_items=>jsonb_build_array(jsonb_build_object('voucher_award_id',p_award,
   'product_id','00000000-0000-0000-0000-000000000007','offer_id','00000000-0000-0000-0000-000000000011','condition','used')),
  p_user_id=>'00000000-0000-0000-0000-000000000004');
 PERFORM pg_sleep(0.5);
 RETURN 'won';
EXCEPTION WHEN object_not_in_prerequisite_state THEN RETURN 'shortage';
END $$;
SELECT dblink_connect('voucher_a',format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'),current_setting('port'),current_database()));
SELECT dblink_connect('voucher_b',format('host=%L port=%s dbname=%L', current_setting('unix_socket_directories'),current_setting('port'),current_database()));
SELECT dblink_send_query('voucher_a',$q$SELECT private.test_concurrent_voucher('00000000-0000-0000-0000-000000000008')$q$);
SELECT dblink_send_query('voucher_b',$q$SELECT private.test_concurrent_voucher('00000000-0000-0000-0000-000000000108')$q$);
CREATE TEMP TABLE voucher_race_results (result text);
INSERT INTO voucher_race_results SELECT result FROM dblink_get_result('voucher_a') AS result(result text);
INSERT INTO voucher_race_results SELECT result FROM dblink_get_result('voucher_b') AS result(result text);
DO $$ BEGIN
 IF (SELECT count(*) FROM voucher_race_results WHERE result='won')<>1
 OR (SELECT count(*) FROM voucher_race_results WHERE result='shortage')<>1
 OR EXISTS (SELECT 1 FROM private.quiz_offer_transition_context)
 OR (SELECT stock_quantity FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011')<>0
 OR (SELECT count(*) FROM public.quiz_awards WHERE status='claimed')<>1
 OR (SELECT count(*) FROM public.quiz_awards WHERE status='approved')<>1
 OR (SELECT count(*) FROM public.variant_inventory WHERE status='reserved' AND order_id IS NOT NULL)<>2 THEN
  RAISE EXCEPTION 'concurrent voucher checkouts must admit exactly one winner';
 END IF;
END $$;
SELECT dblink_disconnect('voucher_a');
SELECT dblink_disconnect('voucher_b');
