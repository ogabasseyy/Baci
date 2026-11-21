-- Rollback-only coverage for the committed financing amount.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('eb200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-total@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','eb200000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000001','oxygen-total@example.test','Oxygen total fixture','oxygen-total-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('eb200000-0000-4000-8000-000000000003','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000001','Total','Fixture','oxygen-total@example.test');

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
    VALUES ('eb200000-0000-4000-8000-000000000004','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','OXYGEN-ZERO',0,'NGN','unpaid','oxygen');
    RAISE EXCEPTION 'Zero-value Oxygen order was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'oxygen_order_total_must_be_positive' THEN RAISE; END IF;
  END;
END
$test$;

INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES
  ('eb200000-0000-4000-8000-000000000005','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','OXYGEN-POSITIVE',100,'NGN','unpaid','oxygen'),
  ('eb200000-0000-4000-8000-000000000006','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','CARD-ZERO',0,'NGN','unpaid','card');
DO $test$
BEGIN
  BEGIN
    UPDATE public.orders SET total = 0
    WHERE id = 'eb200000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'An Oxygen order was edited to zero';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'oxygen_order_total_must_be_positive' THEN RAISE; END IF;
  END;
END
$test$;
ROLLBACK;
