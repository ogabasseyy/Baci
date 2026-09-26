CREATE SCHEMA private;
CREATE TABLE public.orders (
 id uuid PRIMARY KEY, merchant_id uuid, order_number text, tracking_token text,
 customer_email text, subtotal numeric, shipping_fee numeric, total numeric,
 currency text, payment_method text, payment_status text, shipping_status text,
 shipping_address jsonb, shipping_provider text, selected_quote_id uuid,
 updated_at timestamptz, fulfillment_details jsonb
);
CREATE TABLE public.order_items (
 id uuid PRIMARY KEY, order_id uuid, product_id uuid, variant_id uuid,
 quantity integer, fulfillment_data jsonb
);
CREATE TABLE public.variant_inventory (
 id uuid PRIMARY KEY, order_item_id uuid, status text,
 reservation_expires_at timestamptz, updated_at timestamptz,
 identifier_type text, identifier_value text
);
-- External inventory allocation is not under test. Existing reservations below
-- exercise the real renewal path; unreserved rows exercise summary propagation.
CREATE FUNCTION private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)
RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
INSERT INTO public.orders (id, merchant_id, order_number, tracking_token,
 customer_email, subtotal, shipping_fee, total, currency, payment_method,
 payment_status, shipping_status, shipping_address)
VALUES ('10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001', 'TEST-REUSE', 'test-token',
 'checkout@example.test', 100, 10, 110, 'NGN', 'card', 'unpaid', 'pending',
 '{"city":"Lagos"}');
INSERT INTO public.order_items VALUES (
 '30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(),
 1, '{"source":"fixture"}'
);
