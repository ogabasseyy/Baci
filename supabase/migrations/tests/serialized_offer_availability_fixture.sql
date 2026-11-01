CREATE SCHEMA private;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, is_published boolean, is_platform_admin boolean);
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid, condition text, stock integer, stock_quantity integer, inventory_tracking_policy text, has_condition_offers boolean, has_variants boolean, variant_model text, status text);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, product_id uuid, merchant_id uuid, is_inventory_anchor boolean, inventory_tracking_policy text);
CREATE TABLE public.product_offers (id uuid PRIMARY KEY, product_id uuid, merchant_id uuid, condition text, price numeric, stock_quantity integer, status text, compare_at_price numeric, grade text, condition_notes text, images jsonb);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, merchant_id uuid, variant_id uuid, condition_offer_id uuid, branch_id uuid, status text, order_id uuid, order_item_id uuid, sold_at timestamptz);
CREATE TABLE public.branches (id uuid PRIMARY KEY, merchant_id uuid, active boolean);
INSERT INTO public.merchants VALUES ('00000000-0000-0000-0000-000000000010',true,false);
INSERT INTO public.products VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','new',4,4,'serialized_strict',true,false,'legacy','active');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',true,'inherit');
INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status) VALUES
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','used',80,10,'active'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','new',100,10,'active');
INSERT INTO public.variant_inventory(id,merchant_id,variant_id,condition_offer_id,status) VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','available'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','available'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','available'),
 ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002',NULL,'available');
ALTER TABLE public.products ADD COLUMN inventory_anchor_variant_id uuid;
UPDATE public.products SET inventory_anchor_variant_id='00000000-0000-0000-0000-000000000002';
