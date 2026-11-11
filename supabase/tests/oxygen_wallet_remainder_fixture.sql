CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid,email text,business_name text,slug text);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid,first_name text,last_name text,email text);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,order_number text,subtotal numeric,total numeric,currency text,payment_status text DEFAULT 'unpaid',payment_method text,shipping_fee numeric,discount_amount numeric,gift_wrapping_fee numeric,tax_basis text,tax_amount numeric,tax_exclusive_amount numeric,tax_inclusive_amount numeric,notes text,cancelled_at timestamptz,customer_phone text,shipping_address jsonb DEFAULT '{}',amount_paid numeric DEFAULT 0,wallet_amount_used numeric DEFAULT 0,shipping_status text DEFAULT 'pending');
CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),product_id uuid,name text,price numeric,quantity integer,fulfillment_data jsonb,cost_price numeric,supplier_name text);
CREATE TABLE public.order_tax_subtotals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),vat_category_code text,vat_rate numeric,taxable_amount numeric,tax_amount numeric);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid,source_type text,type text,status text DEFAULT 'completed',amount numeric,customer_id uuid,merchant_id uuid);
CREATE TABLE public.customer_savings_redemptions(order_id uuid,amount numeric,customer_id uuid,merchant_id uuid,metadata jsonb DEFAULT '{}');
CREATE TABLE public.transactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, merchant_id uuid,
 transaction_type text, gateway text, gateway_reference text, amount numeric,
 currency text, description text, metadata jsonb
);
ALTER TABLE public.orders ADD COLUMN updated_at timestamptz;
CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.merchants WHERE id=$1 AND user_id=auth.uid());
$$;
CREATE SCHEMA private;
ALTER TABLE public.transactions ADD COLUMN status text;
ALTER TABLE public.orders ADD COLUMN cancelled_by text;

CREATE TABLE public.customer_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,merchant_id uuid,available_balance numeric DEFAULT 0,total_redeemed numeric DEFAULT 0,updated_at timestamptz);
ALTER TABLE public.customer_wallet_transactions ADD COLUMN wallet_id uuid;
ALTER TABLE public.customer_wallet_transactions ADD COLUMN balance_after numeric;
ALTER TABLE public.customer_wallet_transactions ADD COLUMN description text;
CREATE FUNCTION public.check_staff_permission(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
