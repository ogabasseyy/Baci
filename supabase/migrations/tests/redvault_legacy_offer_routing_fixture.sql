DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA private;
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid, offer_line boolean, product_offer_id uuid, offer_labels_snapshotted boolean);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, order_id uuid, order_item_id uuid, status text);
CREATE TABLE private.variant_inventory_events (order_id uuid, order_item_id uuid, event_type text, event_context jsonb, created_at timestamptz, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inventory_unit_id uuid);
INSERT INTO public.order_items VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',true,'00000000-0000-0000-0000-000000000099',true),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010',false,NULL,false),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',true,'00000000-0000-0000-0000-000000000099',true),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010',true,'00000000-0000-0000-0000-000000000099',true),
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010',true,NULL,true),
 ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000010',true,'00000000-0000-0000-0000-000000000099',true);
INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at) SELECT '00000000-0000-0000-0000-000000000010',id,'reserved','{}',now()-interval '1 minute' FROM public.order_items;
INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at) SELECT '00000000-0000-0000-0000-000000000010',id,'reservation_released','{"legacyOfferCleanup":true}',now() FROM public.order_items;
INSERT INTO public.variant_inventory VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003','sold');
INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at) VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','sold','{}',now());
INSERT INTO private.variant_inventory_events (order_id,order_item_id,event_type,event_context,created_at) VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000006','reserved','{"later":true}',now()-interval '1 hour');
