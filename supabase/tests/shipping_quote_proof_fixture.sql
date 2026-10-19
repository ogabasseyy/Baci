-- Synthetic, isolated data only. The harness loads production permission
-- helpers and both real refreshed-quote RPC overloads after this setup.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('service_role_key', repeat('s', 32));

ALTER TABLE public.orders
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN selected_quote_id uuid,
  ADD COLUMN shipping_provider_cost numeric,
  ADD COLUMN shipping_platform_margin numeric,
  ADD COLUMN shipping_pricing_version text,
  ADD COLUMN shipping_funding_source text,
  ADD COLUMN shipping_platform_retained_amount numeric;
CREATE TABLE public.shipping_quotes (
  id uuid PRIMARY KEY, merchant_id uuid, session_id text, provider text,
  service_tier text, carrier_name text, price numeric, provider_cost numeric,
  platform_margin numeric, platform_margin_bps integer, pricing_version text,
  currency text, estimated_days integer, min_days integer, max_days integer,
  pickup_included boolean, insurance_included boolean, is_station_pickup boolean,
  station_name text, station_address text, provider_rate_id text,
  provider_metadata jsonb, expires_at timestamptz, quote_request jsonb
);
CREATE TABLE public.shipping_quote_attestations (
  quote_id uuid PRIMARY KEY, order_id uuid, merchant_id uuid, price numeric,
  provider_cost numeric, platform_margin numeric, currency text,
  pricing_version text, expires_at timestamptz, is_station_pickup boolean,
  provider_rate_id text, quote_request jsonb
);
INSERT INTO public.merchants VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status,
  shipping_funding_source, shipping_provider_cost, shipping_platform_margin,
  shipping_pricing_version, shipping_platform_retained_amount)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'paid', 'processing', 'customer_checkout', 90, 20, 'gigl_platform_margin_v1', 110);
