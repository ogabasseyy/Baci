-- Synthetic, isolated data for the external GIG waybill link suite. Loaded
-- after shipping_quote_proof_fixture.sql (merchants, staff, the real
-- permission helpers and the real route-proof verifier). The harness then
-- loads the production shipment economics trigger and the migration under test.
ALTER TABLE public.orders
  ADD COLUMN shipping_provider text,
  ADD COLUMN fulfillment_type text,
  ADD COLUMN self_fulfillment_data jsonb,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN customer_name text,
  ADD COLUMN customer_phone text,
  ADD COLUMN shipping_address jsonb;
CREATE TABLE public.merchant_feature_settings (
  merchant_id uuid PRIMARY KEY, shipping_providers jsonb
);
CREATE TABLE public.merchant_shipping_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, status text
);
-- Booking-relevant columns and checks of the production table.
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  merchant_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('GIGL', 'TOPSHIP', 'SHIIP')),
  provider_shipment_id text,
  tracking_number text,
  carrier_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'booked', 'pickup_scheduled', 'picked_up', 'in_transit',
    'out_for_delivery', 'delivered', 'cancelled', 'failed', 'returned'
  )),
  sender_address jsonb NOT NULL,
  receiver_address jsonb NOT NULL,
  items jsonb NOT NULL,
  price numeric,
  currency text,
  is_station_pickup boolean DEFAULT false,
  station_address text,
  provider_response jsonb,
  shipping_quote_id uuid,
  provider_cost numeric,
  platform_margin numeric,
  created_at timestamptz DEFAULT now()
);
-- The production column grant: every booking column except economics.
GRANT INSERT (
  order_id, merchant_id, provider, provider_shipment_id, tracking_number,
  carrier_name, status, sender_address, receiver_address, items, price,
  currency, is_station_pickup, station_address, provider_response,
  shipping_quote_id
) ON public.shipments TO authenticated;
GRANT UPDATE (provider_shipment_id, tracking_number, status)
  ON public.shipments TO authenticated;

INSERT INTO public.merchant_feature_settings VALUES
  ('10000000-0000-4000-8000-000000000001', '["gigl"]'),
  ('10000000-0000-4000-8000-000000000002', '["GIGL","topship"]');

-- Merchant 1 (owner 2...1): A and B processing, C delivered, D with a Baci
-- wallet charge, E already self-fulfilled. Merchant 2 (owner 2...2): F.
INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status,
  shipping_provider, fulfillment_type, self_fulfillment_data, tracking_number)
VALUES
  ('41000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001',
    'paid', 'processing', NULL, NULL, NULL, NULL),
  ('41000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001',
    'paid', 'pending', NULL, NULL, NULL, NULL),
  ('41000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000001',
    'paid', 'delivered', NULL, NULL, NULL, NULL),
  ('41000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000001',
    'paid', 'processing', 'GIGL', NULL, NULL, NULL),
  ('41000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001',
    'paid', 'shipped', 'GIGL', 'self',
    '{"carrierName":"Dispatch Rider","trackingNumber":"2000000005"}', '2000000005'),
  ('41000000-0000-4000-8000-00000000000f', '10000000-0000-4000-8000-000000000002',
    'paid', 'processing', NULL, NULL, NULL, NULL);
-- G: cancelled through cancelled_at only. H: a customer-paid Baci GIG quote.
INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status,
  cancelled_at, shipping_funding_source, shipping_platform_retained_amount)
VALUES
  ('41000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    'paid', 'pending', now(), NULL, 0),
  ('41000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
    'paid', 'processing', NULL, 'customer_checkout', 110);
-- I: a merchant-wallet order with a bound Baci quote but no charge yet.
INSERT INTO public.orders (id, merchant_id, payment_status, shipping_status,
  shipping_provider, selected_quote_id, shipping_funding_source,
  shipping_provider_cost, shipping_platform_margin, shipping_pricing_version)
VALUES ('41000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  'paid', 'processing', 'GIGL', '70000000-0000-4000-8000-000000000001',
  'merchant_wallet', 100, 10, 'gigl_platform_margin_v1');
INSERT INTO public.merchant_shipping_charges (order_id, status) VALUES
  ('41000000-0000-4000-8000-00000000000d', 'reserved');
