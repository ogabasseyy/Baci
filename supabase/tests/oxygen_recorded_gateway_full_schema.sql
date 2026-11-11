-- Full-schema regression: recorded gateway evidence blocks Oxygen entry even
-- when its local status is failed. This does not prove pre-dispatch exclusion.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('ea100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-gateway-fence@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','ea100000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('ea100000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000001','oxygen-gateway-fence@example.test','Gateway fixture','oxygen-gateway-fence-fixture');
-- Satisfy the independent customer/funding guard so the recorded payment
-- remains the reason this otherwise eligible order cannot enter Oxygen.
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('ea100000-0000-4000-8000-000000000004','ea100000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000001','Gateway','Fixture','oxygen-gateway-fence@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method)
VALUES ('ea100000-0000-4000-8000-000000000003','ea100000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000004','OXY-GATEWAY-FENCE',100,100,'NGN','unpaid','paystack');
INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference)
VALUES ('ea100000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000003','payment',100,'NGN','failed','paystack','oxygen-gateway-fence-fixture');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET payment_method='oxygen' WHERE id='ea100000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'Recorded gateway did not block Oxygen';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
