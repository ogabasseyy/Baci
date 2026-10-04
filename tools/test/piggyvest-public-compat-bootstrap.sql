CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE piggyvest_full_probe LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE piggyvest_staging_policy_writer LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,user_id uuid);
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,name text,
  price numeric,images jsonb,condition text,status text);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,
  product_id uuid REFERENCES public.products,is_inventory_anchor boolean,condition text,images jsonb,
  primary_image text,price_override numeric,sku text);
CREATE TABLE public.customer_saved_payment_methods(id uuid PRIMARY KEY);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY);
CREATE TABLE public.transactions(id uuid PRIMARY KEY,gateway text,gateway_reference text,metadata jsonb);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,total numeric);
CREATE TABLE public.order_items(id uuid PRIMARY KEY,order_id uuid,product_id uuid,variant_id uuid);
CREATE TABLE public.merchant_feature_settings(id uuid PRIMARY KEY);
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.customers TO authenticated;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_customer_self ON public.customers FOR SELECT TO authenticated USING(user_id=auth.uid());
