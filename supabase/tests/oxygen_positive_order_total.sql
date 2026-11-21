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
  BEGIN
    UPDATE public.orders SET payment_method = 'oxygen'
    WHERE id = 'eb200000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'A zero-value card order switched to Oxygen';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'oxygen_previous_payment_unresolved' THEN RAISE; END IF;
  END;
END
$test$;
-- Simulate a historical row written before this trigger existed. Explicitly
-- assigning the same protected values must still permit an ordinary update.
ALTER TABLE public.orders DISABLE TRIGGER oxygen_positive_order_total;
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('eb200000-0000-4000-8000-000000000009','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','OXYGEN-LEGACY-ZERO',0,'NGN','unpaid','oxygen');
ALTER TABLE public.orders ENABLE TRIGGER oxygen_positive_order_total;
DO $test$
BEGIN
  UPDATE public.orders SET total = total, payment_method = payment_method
  WHERE id = 'eb200000-0000-4000-8000-000000000009';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy Oxygen no-op did not update its fixture row';
  END IF;
  BEGIN
    UPDATE public.orders SET total = 'NaN'::numeric
    WHERE id = 'eb200000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'A non-finite Oxygen amount was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'oxygen_order_total_must_be_positive' THEN RAISE; END IF;
  END;
END
$test$;
-- Trigger calls use the trigger ACL checked when the trigger was created.
-- Verify the existing service role can still insert a valid order and is
-- constrained by the same amount guard even without direct EXECUTE.
SET LOCAL ROLE service_role;
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('eb200000-0000-4000-8000-000000000007','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','OXYGEN-SERVICE-POSITIVE',100,'NGN','unpaid','oxygen');
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
    VALUES ('eb200000-0000-4000-8000-000000000008','eb200000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000003','OXYGEN-SERVICE-ZERO',0,'NGN','unpaid','oxygen');
    RAISE EXCEPTION 'Service role accepted a zero-value Oxygen order';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'oxygen_order_total_must_be_positive' THEN RAISE; END IF;
  END;
END
$test$;
RESET ROLE;
ROLLBACK;
