DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I',role_name);
    END IF;
  END LOOP;
END $$;
CREATE SCHEMA private;
CREATE TABLE public.products (
  id uuid PRIMARY KEY, merchant_id uuid, name text, brand text, status text,
  price numeric, has_variants boolean, inventory_tracking_policy text
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid, currency text, payment_method text,
  payment_status text DEFAULT 'unpaid', shipping_status text DEFAULT 'pending',
  subtotal numeric, discount_amount numeric, tax_amount numeric DEFAULT 0,
  total numeric, shipping_fee numeric DEFAULT 0, gift_wrapping_fee numeric DEFAULT 0,
  wallet_amount_used numeric DEFAULT 0, tracking_number text, shipping_provider text,
  shipment_id uuid, shipped_at timestamptz, delivered_at timestamptz,
  fulfillment_details jsonb, shipment_booking_lock_token uuid
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid,
  product_id uuid, quantity integer, price numeric, variant_id uuid,
  assurance_fee numeric DEFAULT 0
);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, product_id uuid, is_inventory_anchor boolean DEFAULT false);
CREATE TABLE public.customer_savings_redemptions (order_id uuid, amount numeric);
CREATE TABLE private.uba_redvault_applications (
  id uuid PRIMARY KEY, order_id uuid, merchant_id uuid, user_id uuid,
  discount_kobo bigint, eligible_subtotal_kobo bigint
);
CREATE TABLE private.uba_redvault_payment_attempts (
  id uuid PRIMARY KEY, order_id uuid, application_id uuid, merchant_id uuid,
  amount_kobo bigint, currency text
);
CREATE TABLE private.uba_redvault_line_allocations (
  application_id uuid,product_id uuid,order_item_id uuid,unit_ordinal integer,
  allocation_kobo bigint,unit_price_kobo bigint,variant_id uuid
);
CREATE TABLE public.shipments (id uuid DEFAULT gen_random_uuid(),order_id uuid);
CREATE FUNCTION private.is_uba_redvault_negotiable_product(text,text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IS DISTINCT FROM 'Vivo' $$;
CREATE FUNCTION private.enforce_uba_redvault_private_pilot_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy_order_guard';
END;
$$;
CREATE FUNCTION private.enforce_uba_redvault_private_pilot_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy_attempt_guard';
END;
$$;
CREATE FUNCTION private.validate_redvault_commercial_terms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy_terms_guard';
END;
$$;
CREATE FUNCTION private.assert_uba_redvault_private_pilot_active(p_order_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy_active_guard';
END;
$$;
CREATE TRIGGER pilot_order BEFORE INSERT ON private.uba_redvault_applications
FOR EACH ROW EXECUTE FUNCTION private.enforce_uba_redvault_private_pilot_order();
CREATE TRIGGER pilot_attempt BEFORE INSERT ON private.uba_redvault_payment_attempts
FOR EACH ROW EXECUTE FUNCTION private.enforce_uba_redvault_private_pilot_attempt();
