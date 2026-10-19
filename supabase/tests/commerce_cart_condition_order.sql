-- The actual final order leaf is installed by the local runner. Only schema,
-- auth and serialized inventory side effects are stubbed; no order RPC is mocked.
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.is_agentic_checkout_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE merchants(id uuid PRIMARY KEY,country text,payout_currency text DEFAULT 'NGN',vat_registration_status text DEFAULT 'not_registered',vat_rate numeric DEFAULT 7.5,is_published boolean DEFAULT true,is_platform_admin boolean DEFAULT false);
CREATE TABLE products(id uuid PRIMARY KEY,merchant_id uuid,name text,price numeric(10,2),condition text DEFAULT 'new',status text DEFAULT 'active',manage_stock boolean DEFAULT true,stock_quantity integer DEFAULT 20,inventory_tracking_policy text DEFAULT 'off',vat_category_code text DEFAULT 'S',vat_rate numeric DEFAULT 7.5);
CREATE TABLE product_variants(id uuid PRIMARY KEY,merchant_id uuid,product_id uuid,price_override numeric,stock_quantity integer,attributes jsonb DEFAULT '{}',is_active boolean DEFAULT true,status text DEFAULT 'active',deleted_at timestamptz,archived_at timestamptz,is_inventory_anchor boolean DEFAULT false);
CREATE TABLE product_offers(id uuid PRIMARY KEY,merchant_id uuid,product_id uuid,condition text,price numeric(10,2),stock_quantity integer,status text DEFAULT 'active',UNIQUE(product_id,condition));
CREATE TABLE customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,email text,phone text,user_id uuid,first_name text,last_name text,updated_at timestamptz DEFAULT now());
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,customer_id uuid,customer_email text,customer_name text,customer_phone text,subtotal numeric,shipping_fee numeric,discount_amount numeric,tax_amount numeric,total numeric,currency text,payment_method text,payment_status text,shipping_status text,shipping_address jsonb,source text,notes text,ad_tracking jsonb,selected_quote_id uuid,shipping_provider text,tracking_number text,tax_basis text,gift_wrapping_fee numeric,checkout_idempotency_key text,checkout_request_hash text,order_number text DEFAULT 'fixture-order',tracking_token text DEFAULT 'fixture-track',updated_at timestamptz DEFAULT now());
CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,product_id uuid,condition text,image_url text,variant_id uuid,variant_name text,name text,price numeric,quantity integer,has_assurance boolean,assurance_fee numeric,variant_attributes jsonb);
CREATE FUNCTION public.format_order_item_variant_name(jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.get_effective_inventory_tracking_policy(text,text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN $2 IN ('off','serialized_strict','serialized_then_unlimited') THEN $2 ELSE $1 END $$;
CREATE FUNCTION private.claim_variant_inventory_units_for_order_item_internal(uuid,uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION private.enforce_storefront_order_route_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
INSERT INTO merchants(id) VALUES('11111111-1111-4111-8111-111111111111'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO products(id,merchant_id,name,price) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Fixture product',15);
INSERT INTO product_offers(id,merchant_id,product_id,condition,price,stock_quantity) VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','used',10,3);
ALTER TABLE product_variants ADD COLUMN inventory_tracking_policy text DEFAULT 'inherit';
ALTER TABLE orders ADD COLUMN cancelled_at timestamptz,ADD COLUMN shipment_id uuid,ADD COLUMN shipped_at timestamptz,ADD COLUMN delivered_at timestamptz,ADD COLUMN shipment_booking_lock_token text;
ALTER TABLE order_items ADD COLUMN fulfillment_data jsonb;
CREATE TABLE shipments(order_id uuid);
CREATE TABLE private.uba_redvault_refunds(id uuid,attempt_id uuid,state text,refund_type text);
CREATE TABLE private.uba_redvault_payment_attempts(id uuid,order_id uuid);
CREATE TABLE private.uba_redvault_refund_line_allocations(refund_id uuid,order_item_id uuid);
CREATE TABLE private.uba_redvault_refund_lifecycle(refund_id uuid,inventory_state text);
CREATE FUNCTION private.redvault_line_was_serialized(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- Empty physical-unit fixture makes the strict condition counterexample explicit.
CREATE TABLE public.variant_inventory(id uuid,merchant_id uuid,variant_id uuid,status text,order_id uuid,order_item_id uuid,sold_at timestamptz);
