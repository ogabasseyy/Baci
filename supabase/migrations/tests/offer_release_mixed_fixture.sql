CREATE SCHEMA private;
CREATE TABLE public.order_items (id uuid PRIMARY KEY, fulfillment_data jsonb);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, product_id uuid);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, variant_id uuid, merchant_id uuid, order_id uuid, order_item_id uuid, branch_id uuid, status text, reserved_at timestamptz, reservation_expires_at timestamptz, updated_at timestamptz);
CREATE FUNCTION private.record_variant_inventory_event(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.order_items VALUES ('00000000-0000-0000-0000-000000000001', '{"inventoryUnits":[{"inventoryUnitId":"00000000-0000-0000-0000-000000000002","identifierValue":"released"},{"inventoryUnitId":"00000000-0000-0000-0000-000000000003","identifierValue":"sold"}],"refundReference":"keep"}');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005');
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,order_id,order_item_id,status) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','reserved'),('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','sold');
