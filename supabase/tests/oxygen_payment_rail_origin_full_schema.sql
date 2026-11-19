-- Rollback-only checks against the full replayed schema; no provider calls.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('eb100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-origin@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000001','oxygen-origin@example.test','Origin fixture','oxygen-origin-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('eb100000-0000-4000-8000-000000000003','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000001','Origin','Fixture','oxygen-origin@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method)
VALUES
 ('eb100000-0000-4000-8000-000000000004','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000003','ORIGIN-CARD',100,100,'NGN','unpaid','card'),
 ('eb100000-0000-4000-8000-000000000005','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000003','ORIGIN-OXYGEN',100,100,'NGN','unpaid','oxygen'),
 ('eb100000-0000-4000-8000-000000000006','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000003','ORIGIN-LEGACY',100,100,'NGN','unpaid','oxygen');
-- Simulate a pre-migration order; production never performs this deletion.
DELETE FROM oxygen_private.payment_rail_origins WHERE order_id='eb100000-0000-4000-8000-000000000006';
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('eb100000-0000-4000-8000-000000000007','eb100000-0000-4000-8000-000000000005','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000003');
DO $$ BEGIN
 IF has_table_privilege('authenticated','oxygen_private.payment_rail_origins','INSERT')
 OR has_table_privilege('anon','oxygen_private.payment_rail_origins','INSERT') THEN
  RAISE EXCEPTION 'Payment origin can be forged';
 END IF;
 BEGIN
  UPDATE public.orders SET payment_method='oxygen' WHERE id='eb100000-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'Gateway order entered Oxygen' USING ERRCODE='P1001';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_previous_payment_unresolved' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
  VALUES ('eb100000-0000-4000-8000-000000000008','eb100000-0000-4000-8000-000000000006','eb100000-0000-4000-8000-000000000002','eb100000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'Legacy origin was trusted' USING ERRCODE='P1002';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_payment_origin_unverified' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
