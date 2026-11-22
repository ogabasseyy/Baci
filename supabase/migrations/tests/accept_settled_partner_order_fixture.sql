-- Minimal storefront writer contract for testing partner admission in isolation.
-- This fixture is installed only in a disposable database.
ALTER TABLE public.merchants ADD COLUMN vat_registration_status text DEFAULT 'not_registered';
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid, vat_rate numeric, vat_category_code text);
CREATE TABLE public.partner_writer_fixture_products (
  id uuid PRIMARY KEY, base_price numeric NOT NULL, stock integer NOT NULL
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL,
  currency text NOT NULL, source text NOT NULL, total numeric NOT NULL,
  shipping_fee numeric NOT NULL, subtotal numeric NOT NULL, tax_amount numeric NOT NULL, selected_quote_id uuid,
  shipping_funding_source text, amount_paid numeric DEFAULT 0, payment_status text NOT NULL,
  shipping_status text, shipping_provider text, tracking_number text, shipment_id uuid, updated_at timestamptz
);
CREATE TABLE public.order_items (
  order_id uuid NOT NULL REFERENCES public.orders (id), product_id uuid NOT NULL,
  variant_id uuid, product_offer_id uuid, quantity integer NOT NULL, price numeric NOT NULL
);
CREATE TABLE public.transactions (
  merchant_id uuid NOT NULL, order_id uuid NOT NULL REFERENCES public.orders (id),
  transaction_type text NOT NULL, amount numeric NOT NULL, currency text NOT NULL,
  status text NOT NULL, gateway text NOT NULL, gateway_reference text NOT NULL,
  description text, metadata jsonb
);

CREATE FUNCTION private.create_storefront_order(
  p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb,
  p_customer_phone text, p_shipping_fee numeric, p_tax_amount numeric, p_payment_method text,
  p_payment_status text, p_shipping_address jsonb, p_source text,
  p_expected_total numeric
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql AS $$
DECLARE
  line record;
  v_id uuid := gen_random_uuid();
  v_subtotal numeric := 0;
BEGIN
  FOR line IN SELECT * FROM jsonb_to_recordset(p_items) AS item(product_id uuid, quantity integer)
  LOOP
    UPDATE public.partner_writer_fixture_products AS p
    SET stock = p.stock - line.quantity WHERE p.id = line.product_id AND p.stock >= line.quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
    v_subtotal := v_subtotal + line.quantity * (
      SELECT base_price FROM public.partner_writer_fixture_products AS p WHERE p.id = line.product_id
    );
  END LOOP;
  IF abs(v_subtotal + p_shipping_fee + p_tax_amount - p_expected_total) > 1 THEN
    RAISE EXCEPTION 'order_total_mismatch';
  END IF;

  INSERT INTO public.orders (
    id, merchant_id, currency, source, total, shipping_fee, subtotal, tax_amount, payment_status
  ) VALUES (
    v_id, p_merchant_id, 'NGN', p_source, v_subtotal + p_shipping_fee + p_tax_amount,
    p_shipping_fee, v_subtotal, p_tax_amount, p_payment_status
  );
  INSERT INTO public.order_items (order_id, product_id, variant_id, product_offer_id, quantity, price)
  SELECT v_id, i.product_id, i.variant_id, i.offer_id, i.quantity, p.base_price
  FROM jsonb_to_recordset(p_items) AS i(product_id uuid, variant_id uuid, offer_id uuid, quantity integer)
  JOIN public.partner_writer_fixture_products AS p ON p.id = i.product_id;
  RETURN QUERY SELECT v_id;
END;
$$;

ALTER TABLE public.orders ADD COLUMN shipping_platform_retained_amount numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN payment_method text;

CREATE TABLE public.shipping_quotes (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, provider text NOT NULL,
  currency text NOT NULL, session_id text NOT NULL, expires_at timestamptz NOT NULL,
  used boolean, is_station_pickup boolean, price numeric NOT NULL,
  provider_rate_id text, quote_request jsonb, service_tier text
);
CREATE TABLE public.shipping_quote_attestations (
  quote_id uuid PRIMARY KEY REFERENCES public.shipping_quotes (id),
  merchant_id uuid NOT NULL, order_id uuid NOT NULL REFERENCES public.orders (id),
  price numeric NOT NULL, currency text NOT NULL, provider_rate_id text,
  quote_request jsonb, expires_at timestamptz NOT NULL
);
