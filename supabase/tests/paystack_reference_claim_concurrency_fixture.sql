CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL,
  aud text NOT NULL,
  role text NOT NULL,
  email text NOT NULL,
  encrypted_password text NOT NULL,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  raw_app_meta_data jsonb NOT NULL,
  raw_user_meta_data jsonb NOT NULL
);

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  email text NOT NULL,
  business_name text NOT NULL,
  slug text NOT NULL
);

CREATE TABLE public.staff_members (
  merchant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  order_number text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  payment_status text NOT NULL,
  shipping_status text,
  subtotal numeric NOT NULL,
  total numeric NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  currency text NOT NULL,
  source text NOT NULL,
  recorded_by_user_id uuid,
  chat_order_id uuid,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reconciliation_review (
  id uuid PRIMARY KEY,
  issue_type text NOT NULL,
  paystack_ref text NOT NULL,
  order_id uuid NOT NULL,
  reason text NOT NULL,
  candidates jsonb NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_notes text,
  metadata jsonb
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  order_id uuid,
  transaction_type text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  gateway text,
  gateway_reference text,
  platform_fee numeric NOT NULL,
  merchant_amount numeric NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  gateway_response jsonb
);

CREATE TABLE public.merchant_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_reference text NOT NULL
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  changes jsonb,
  status text,
  user_id uuid
);

CREATE OR REPLACE FUNCTION public.complete_merchant_invoice_partial_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_paystack_reference text,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_gateway_response jsonb,
  p_actor text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount numeric;
BEGIN
  SELECT amount INTO v_amount FROM public.transactions WHERE id = p_transaction_id;
  UPDATE public.transactions
     SET status = 'completed', gateway_response = p_gateway_response
   WHERE id = p_transaction_id;
  UPDATE public.orders
     SET amount_paid = amount_paid + v_amount, payment_status = 'partially_paid'
   WHERE id = p_order_id;
  RETURN jsonb_build_object('outcome', 'partial_recorded', 'balance_due', 900);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_payment_transaction(
  p_merchant_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_currency text,
  p_gateway text,
  p_reference text,
  p_platform_fee numeric,
  p_merchant_amount numeric,
  p_customer_email text,
  p_customer_name text,
  p_session_id text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(trim(COALESCE(p_reference, '')), 0)
  );
  SELECT id INTO v_existing_id
    FROM public.transactions
   WHERE gateway_reference = trim(p_reference)
   FOR UPDATE;
  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'reference_in_use';
  END IF;
  INSERT INTO public.transactions (
    merchant_id, order_id, transaction_type, amount, currency, status, gateway,
    gateway_reference, platform_fee, merchant_amount, description, metadata
  ) VALUES (
    p_merchant_id, p_order_id, 'payment', p_amount, p_currency, 'pending',
    lower(trim(p_gateway)), trim(p_reference), p_platform_fee, p_merchant_amount,
    'Payment for order ' || p_order_id::text, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_existing_id;
  RETURN v_existing_id;
END;
$$;
