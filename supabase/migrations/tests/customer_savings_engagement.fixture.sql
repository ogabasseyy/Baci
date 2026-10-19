CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id), user_id uuid, deleted_at timestamptz);
CREATE TABLE public.customer_savings_goals(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id), customer_id uuid NOT NULL REFERENCES public.customers(id),
  title text NOT NULL DEFAULT 'Test phone', target_amount numeric NOT NULL DEFAULT 1000, current_amount numeric NOT NULL DEFAULT 0,
  contribution_amount numeric NOT NULL DEFAULT 100, contribution_frequency text NOT NULL DEFAULT 'daily',
  preferred_debit_time time DEFAULT '09:00', start_date date NOT NULL DEFAULT current_date,
  maturity_date date NOT NULL DEFAULT current_date + 100, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id), customer_id uuid NOT NULL REFERENCES public.customers(id),
  amount numeric NOT NULL, status text NOT NULL DEFAULT 'pending', processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.push_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id), token text NOT NULL, app_type text NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
