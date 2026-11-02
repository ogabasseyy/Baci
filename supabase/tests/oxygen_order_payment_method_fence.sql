-- Transactional test against the replayed database; no provider calls.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('ab120000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fence@example.test','test',now(),now(),now(),'{}','{}');
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000001','fence@example.test','Fence fixture','oxygen-order-fence-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('ab120000-0000-4000-8000-000000000003','ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000001','Test','Customer','fence@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000003','OXYGEN-FENCE',100000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(order_id,merchant_id,customer_id)
VALUES ('ab120000-0000-4000-8000-000000000004','ab120000-0000-4000-8000-000000000002','ab120000-0000-4000-8000-000000000003');
DO $$ BEGIN
  BEGIN
    UPDATE public.orders SET payment_method='card' WHERE id='ab120000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Oxygen order was repurposed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'oxygen_payment_in_progress' THEN RAISE; END IF;
  END;
  UPDATE public.orders SET payment_method='oxygen' WHERE id='ab120000-0000-4000-8000-000000000004';
END $$;
-- Cleanup must not cancel an old unpaid commerce order with a live workflow.
UPDATE public.orders SET created_at=now()-interval '10 days' WHERE id='ab120000-0000-4000-8000-000000000004';
SELECT public.mark_abandoned_orders(72);
DO $$ BEGIN
 IF (SELECT payment_status FROM public.orders WHERE id='ab120000-0000-4000-8000-000000000004') <> 'unpaid' THEN
  RAISE EXCEPTION 'Cleanup cancelled an Oxygen workflow order';
 END IF;
END $$;
ROLLBACK;
