CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE piggyvest_full_probe LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES public.merchants,user_id uuid);
CREATE TABLE public.products(id uuid PRIMARY KEY);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY);
CREATE TABLE public.merchant_shipping_rates(id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES public.merchants);
CREATE TABLE public.customer_savings_goals(
  id uuid PRIMARY KEY,merchant_id uuid NOT NULL REFERENCES public.merchants,customer_id uuid NOT NULL REFERENCES public.customers,
  product_id uuid REFERENCES public.products,variant_id uuid REFERENCES public.product_variants,product_snapshot jsonb,
  updated_at timestamptz,current_amount numeric,initial_contribution_amount numeric,status text,
  completed_at timestamptz,cancelled_at timestamptz,spent_at timestamptz
);
CREATE TABLE public.customer_savings_contributions(id uuid PRIMARY KEY,goal_id uuid REFERENCES public.customer_savings_goals,status text);
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_savings_contributions ENABLE ROW LEVEL SECURITY;
