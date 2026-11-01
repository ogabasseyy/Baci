DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres SUPERUSER; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA private;
CREATE TABLE public.orders (id uuid PRIMARY KEY, payment_method text);
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid, fulfillment_data jsonb, offer_line boolean, product_offer_id uuid, offer_labels_snapshotted boolean);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, order_item_id uuid, status text);
INSERT INTO public.orders VALUES ('00000000-0000-0000-0000-000000000001','uba_redvault');
INSERT INTO public.order_items VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','{}',false,NULL,false);
INSERT INTO public.variant_inventory VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','reserved');
