DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA private;
CREATE TABLE public.order_items (id uuid PRIMARY KEY, fulfillment_data jsonb, order_id uuid, product_offer_id uuid);
CREATE TABLE private.variant_inventory_events (order_id uuid, order_item_id uuid, event_type text, event_context jsonb, created_at timestamptz, id uuid DEFAULT gen_random_uuid() PRIMARY KEY, inventory_unit_id uuid);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, product_id uuid);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, variant_id uuid, merchant_id uuid, order_id uuid, order_item_id uuid, branch_id uuid, status text, reserved_at timestamptz, reservation_expires_at timestamptz, updated_at timestamptz);
CREATE FUNCTION private.record_variant_inventory_event(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at,inventory_unit_id) VALUES ($8,$9,$5,private.build_safe_variant_inventory_event_context($5,$13),clock_timestamp(),$1); END $$;
INSERT INTO public.order_items(id,fulfillment_data) VALUES ('00000000-0000-0000-0000-000000000001', '{"inventoryUnits":[{"inventoryUnitId":"00000000-0000-0000-0000-000000000002","identifierValue":"released"},{"inventoryUnitId":"00000000-0000-0000-0000-000000000003","identifierValue":"sold"}],"refundReference":"keep"}');
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005');
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,order_id,order_item_id,status) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','reserved'),('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','sold');

UPDATE public.order_items SET order_id='00000000-0000-0000-0000-000000000007', product_offer_id='00000000-0000-0000-0000-000000000099';
INSERT INTO public.order_items VALUES ('00000000-0000-0000-0000-000000000011','{}','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000099');
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,order_id,order_item_id,status) VALUES ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000011','reserved');
INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at,inventory_unit_id) VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000011','reserved','{}',now()-interval '1 minute','00000000-0000-0000-0000-000000000012');
