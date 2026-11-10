-- Executes against the complete replayed database and rolls back all fixtures.
BEGIN;
-- Merchant audit triggers require a transaction-local actor for fixture writes.
SELECT pg_catalog.set_config('app.audit_actor_user_id','cb710000-0000-4000-8000-000000000001',true);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('cb710000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-credit-fixture@example.test','test',now(),now(),now(),'{}','{}');
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('cb710000-0000-4000-8000-000000000002','cb710000-0000-4000-8000-000000000001','oxygen-credit-fixture@example.test','Credit fixture','oxygen-credit-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('cb710000-0000-4000-8000-000000000003','cb710000-0000-4000-8000-000000000002','cb710000-0000-4000-8000-000000000001','Credit','Fixture','oxygen-credit-fixture@example.test');
-- Exercise the existing merchant-owner route-context gate for the order fixture.
SELECT pg_catalog.set_config('request.jwt.claim.sub','cb710000-0000-4000-8000-000000000001',true);
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount,wallet_amount_used)
VALUES ('cb710000-0000-4000-8000-000000000004','cb710000-0000-4000-8000-000000000002','cb710000-0000-4000-8000-000000000003','OXYGEN-CREDIT-FIXTURE',100,100,'NGN','unpaid','oxygen',0,0,10);
DO $$ BEGIN
 BEGIN
  INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,stage)
  VALUES ('cb710000-0000-4000-8000-000000000005','cb710000-0000-4000-8000-000000000004','cb710000-0000-4000-8000-000000000002','cb710000-0000-4000-8000-000000000003','application_required');
  RAISE EXCEPTION 'wallet credit bypassed Oxygen admission';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.customer_savings_redemptions'::regclass AND tgname='oxygen_local_savings_credit_guard' AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.customer_wallet_transactions'::regclass AND tgname='oxygen_local_wallet_credit_guard' AND tgenabled='O') THEN
  RAISE EXCEPTION 'credit ledger guards unavailable';
 END IF;
END $$;
ROLLBACK;
