ALTER TABLE public.orders ADD COLUMN updated_at timestamptz DEFAULT now(),
  ADD COLUMN shipping_address jsonb, ADD COLUMN shipping_fee numeric,
  ADD COLUMN fulfillment_type text, ADD COLUMN shipping_provider text, ADD COLUMN customer_name text,
  ADD COLUMN customer_email text, ADD COLUMN customer_phone text;
CREATE TABLE public.products (
  id uuid PRIMARY KEY, weight_value numeric, weight_unit text,
  dimensions jsonb, commodity_code text
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY, order_id uuid REFERENCES public.orders(id),
  product_id uuid REFERENCES public.products(id), name text,
  quantity integer, price numeric, fulfillment_data jsonb
);
UPDATE public.orders SET shipping_provider='GIGL', shipping_fee=110,
  payment_method='card', customer_name='Test Customer', customer_phone='08000000000',
  shipping_address='{"address":"12 Test Street","city":"Ikeja","state":"Lagos"}';
INSERT INTO public.products VALUES (
  '50000000-0000-4000-8000-000000000001',1,'kg',NULL,NULL
);
INSERT INTO public.order_items VALUES (
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','Phone',1,1000
);

CREATE TABLE public.merchant_settlements (source_type text, source_id uuid, merchant_id uuid, status text, metadata jsonb, id uuid DEFAULT gen_random_uuid());
CREATE TABLE public.transactions (merchant_id uuid, order_id uuid, status text, gateway text, amount numeric, id uuid DEFAULT gen_random_uuid());
CREATE TABLE public.customer_wallet_transactions (merchant_id uuid, source_type text, source_id uuid, status text, amount numeric, id uuid DEFAULT gen_random_uuid());
CREATE TABLE public.customer_savings_redemptions (merchant_id uuid, order_id uuid, metadata jsonb, amount numeric, id uuid DEFAULT gen_random_uuid());
INSERT INTO public.merchant_settlements (source_type,source_id,merchant_id,status,metadata) VALUES ('order','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed','{"retained_shipping_amount":110}');
