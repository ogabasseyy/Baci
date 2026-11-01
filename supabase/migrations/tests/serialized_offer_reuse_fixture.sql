ALTER TABLE public.orders ADD COLUMN order_number text, ADD COLUMN tracking_token text, ADD COLUMN customer_email text,
 ADD COLUMN subtotal numeric, ADD COLUMN shipping_fee numeric, ADD COLUMN total numeric, ADD COLUMN currency text,
 ADD COLUMN shipping_status text, ADD COLUMN shipping_address jsonb, ADD COLUMN shipping_provider text,
 ADD COLUMN selected_quote_id uuid, ADD COLUMN updated_at timestamptz;
UPDATE public.orders SET order_number='test',tracking_token='token',customer_email='buyer@example.com',subtotal=80,shipping_fee=0,total=80,currency='NGN',shipping_status='pending';
UPDATE public.order_items SET fulfillment_data = '{"refundReference":"keep-me","shipmentQuantity":1}'::jsonb WHERE id='00000000-0000-0000-0000-000000000006';
