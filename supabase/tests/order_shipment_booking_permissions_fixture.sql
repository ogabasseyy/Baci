-- Minimal schema for the isolated PostgreSQL permission regression runner.
-- The runner loads the real access helpers, order policies and booking RPC.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TYPE public.staff_role AS ENUM ('sales_rep', 'manager');
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY, merchant_id uuid, user_id uuid,
  role public.staff_role, permissions jsonb, status text
);
CREATE TABLE public.role_permissions (role public.staff_role, permissions jsonb);
CREATE TABLE public.customers (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid, customer_id uuid, source text,
  payment_method text, payment_status text, shipping_status text,
  shipment_id uuid, tracking_number text, shipment_booking_lock_token uuid,
  shipment_booking_started_at timestamptz
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.merchants TO authenticated;
GRANT SELECT, UPDATE ON public.orders TO authenticated, service_role;

CREATE TABLE private.uba_redvault_payment_attempts (id uuid PRIMARY KEY, order_id uuid);
CREATE TABLE private.uba_redvault_refunds (
  id uuid PRIMARY KEY, attempt_id uuid, refund_type text, state text
);
CREATE TABLE private.uba_redvault_refund_lifecycle (refund_id uuid, inventory_state text);

-- Agentic checkout is inactive in this merchant-session fixture. The order
-- policies themselves are extracted unchanged from the production migration.
CREATE FUNCTION public.is_agentic_checkout_context() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.current_agentic_merchant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
