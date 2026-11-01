ALTER TABLE public.order_items ADD COLUMN product_offer_id uuid, ADD COLUMN offer_id uuid, ADD COLUMN offer_line boolean DEFAULT false, ADD COLUMN offer_id_snapshot uuid;
ALTER TABLE public.variant_inventory ADD COLUMN condition_offer_id uuid;
CREATE OR REPLACE FUNCTION private.ensure_product_inventory_anchor_variant(uuid, uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT inventory_anchor_variant_id FROM public.products WHERE merchant_id=$1 AND id=$2 $$;
INSERT INTO public.products(id,merchant_id,has_variants,variant_model,inventory_tracking_policy,inventory_anchor_variant_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',false,'legacy','serialized_strict','00000000-0000-0000-0000-000000000002');
INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','inherit',true);
INSERT INTO private.inventory_product_locks(product_id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.orders(id,merchant_id,payment_status,payment_method) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','pending','card');
INSERT INTO public.order_items(id,order_id,product_id,quantity,product_offer_id,offer_id,offer_line) VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003',true);
UPDATE public.order_items SET offer_id_snapshot=offer_id WHERE id='00000000-0000-0000-0000-000000000006';
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,status,condition_offer_id,created_at) VALUES
 ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','available','00000000-0000-0000-0000-000000000004','2026-01-01'),
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','available','00000000-0000-0000-0000-000000000003','2026-01-02');
CREATE TABLE public.branches (id uuid PRIMARY KEY, merchant_id uuid, active boolean);
