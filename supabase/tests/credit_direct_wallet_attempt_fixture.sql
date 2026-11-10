CREATE ROLE postgres SUPERUSER; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.role',true),'')$$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,total numeric,currency text DEFAULT 'NGN',customer_email text DEFAULT 'wallet@example.com',tracking_token text DEFAULT 'unguessable-tracking-token',amount_paid numeric DEFAULT 0,wallet_amount_used numeric DEFAULT 0,payment_status text DEFAULT 'unpaid',payment_method text DEFAULT 'credit_direct',shipping_status text DEFAULT 'pending',notes text DEFAULT '{}',shipping_funding_source text,shipping_platform_retained_amount numeric DEFAULT 0);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid,credit_direct_enabled boolean,credit_direct_min_amount numeric,credit_direct_max_amount numeric);
CREATE TABLE public.customer_wallet_transactions(source_id uuid,source_type text,type text,amount numeric,customer_id uuid,merchant_id uuid,status text DEFAULT 'completed');
CREATE TABLE public.customer_savings_redemptions(order_id uuid,amount numeric);
CREATE TABLE public.transactions(order_id uuid,transaction_type text);
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.orders TO authenticated;

ALTER TABLE public.merchants ADD COLUMN user_id uuid;
ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz, ADD COLUMN cancelled_by text;
CREATE FUNCTION public.check_staff_permission(uuid,uuid,text,text)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.customer_wallets(
 id uuid PRIMARY KEY, merchant_id uuid, customer_id uuid, available_balance numeric,
 total_redeemed numeric, updated_at timestamptz
);
ALTER TABLE public.customer_wallet_transactions
 ADD COLUMN id uuid DEFAULT extensions.gen_random_uuid() PRIMARY KEY,
 ADD COLUMN wallet_id uuid,
 ADD COLUMN balance_after numeric,
 ADD COLUMN description text;
