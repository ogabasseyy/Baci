CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,total numeric,currency text,amount_paid numeric DEFAULT 0,wallet_amount_used numeric DEFAULT 0,payment_status text DEFAULT 'unpaid',shipping_status text DEFAULT 'pending',cancelled_at timestamptz);
CREATE TABLE public.customer_wallet_transactions(source_id uuid,source_type text,type text,amount numeric,customer_id uuid,merchant_id uuid,status text DEFAULT 'completed');
CREATE TABLE public.customer_savings_redemptions(order_id uuid,amount numeric,customer_id uuid,merchant_id uuid,metadata jsonb DEFAULT '{}');
CREATE TABLE public.transactions(order_id uuid,transaction_type text,status text DEFAULT 'pending');
INSERT INTO public.customers VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
INSERT INTO public.orders(id,merchant_id,customer_id,total,currency)
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,'NGN' FROM generate_series(10,23) n;
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount,customer_id,merchant_id) SELECT id,'order_redemption','redemption',20000,customer_id,merchant_id FROM public.orders;
INSERT INTO public.customer_savings_redemptions SELECT id,5000,customer_id,merchant_id,'{}' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000011';
INSERT INTO public.transactions(order_id,transaction_type) VALUES('00000000-0000-4000-8000-000000000012','payment');
UPDATE public.orders SET currency='USD' WHERE id='00000000-0000-4000-8000-000000000013';
UPDATE public.orders SET payment_status='cancelled' WHERE id='00000000-0000-4000-8000-000000000014';
UPDATE public.orders SET amount_paid=1000 WHERE id='00000000-0000-4000-8000-000000000015';
UPDATE public.customer_wallet_transactions SET amount=60000 WHERE source_id='00000000-0000-4000-8000-000000000016';
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount,customer_id,merchant_id) SELECT id,'order_refund','refund',20000,customer_id,merchant_id FROM public.orders WHERE id='00000000-0000-4000-8000-000000000017';
UPDATE public.customer_wallet_transactions SET customer_id='00000000-0000-4000-8000-000000000009' WHERE source_id='00000000-0000-4000-8000-000000000018';
INSERT INTO public.customer_savings_redemptions SELECT id,5000,customer_id,merchant_id,'{"reversed_at":"2026-11-07"}' FROM public.orders WHERE id='00000000-0000-4000-8000-000000000019';
UPDATE public.customer_wallet_transactions SET amount=50000 WHERE source_id='00000000-0000-4000-8000-000000000020';

UPDATE public.customer_wallet_transactions SET status='pending' WHERE source_id='00000000-0000-4000-8000-000000000021';

UPDATE public.orders SET payment_status=NULL WHERE id='00000000-0000-4000-8000-000000000022';
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount,customer_id,merchant_id) SELECT id,'order_reversal','adjustment',20000,customer_id,merchant_id FROM public.orders WHERE id='00000000-0000-4000-8000-000000000023';
