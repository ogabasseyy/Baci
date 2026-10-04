-- Disposable fixture only. Never apply this file to a deployed database.
CREATE SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FUNCTION public.normalize_product_search_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(trim($1)) $$;
CREATE FUNCTION public.compact_product_search_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT replace(lower(trim($1)),' ','') $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,is_published boolean);
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid,name text,brand text,category text,category_id uuid,status text,price numeric,condition text,manage_stock boolean,stock integer,stock_quantity integer,inventory_tracking_policy text,has_condition_offers boolean,has_variants boolean,average_rating float,view_count integer,created_at timestamptz DEFAULT now(),sku text,search_name_norm text,search_name_compact text,search_doc_vector tsvector,search_identify_vector tsvector);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,condition text,price_override numeric,stock_quantity integer,inventory_tracking_policy text,is_inventory_anchor boolean);
CREATE TABLE public.product_offers(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,condition text,price numeric,stock_quantity integer,status text);
CREATE FUNCTION public.get_public_serialized_variant_availability_counts(uuid,uuid[],uuid DEFAULT NULL) RETURNS TABLE(variant_id uuid,public_available_units integer) LANGUAGE sql AS $$ SELECT NULL::uuid,0 WHERE false $$;
INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000001',true),('00000000-0000-4000-8000-000000000002',false);
INSERT INTO public.products(id,merchant_id,name,brand,status,price,condition,manage_stock,has_condition_offers,has_variants,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector)
VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Apple phone','Apple','active',200000,'new',false,false,true,'apple phone','applephone',to_tsvector('simple','apple phone'),to_tsvector('simple','apple phone')),
('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','Samsung phone','Samsung','active',100000,'new',NULL,false,false,'samsung phone','samsungphone',to_tsvector('simple','samsung phone'),to_tsvector('simple','samsung phone')),
('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','Hidden phone','Hidden','active',100,'new',false,false,false,'hidden phone','hiddenphone',to_tsvector('simple','hidden phone'),to_tsvector('simple','hidden phone'));
INSERT INTO public.product_variants VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','new',500000,1,NULL,false),('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','used',200000,1,NULL,false);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_publication ON public.products FOR SELECT USING (status='active' AND EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.is_published));
GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated;
GRANT SELECT ON public.products,public.merchants TO anon,authenticated;
-- No protected variant/offer grants: the public safe projection must suffice.

INSERT INTO public.products(id,merchant_id,name,brand,status,price,condition,manage_stock,stock_quantity,has_condition_offers,has_variants,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector) VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','sold phone','Sold','active',100000,'new',true,0,false,false,'sold phone','soldphone',to_tsvector('simple','sold phone'),to_tsvector('simple','sold phone'));
-- More than one result page and more than the old 100-row brand RPC limit.
INSERT INTO public.products(id,merchant_id,name,brand,status,price,condition,manage_stock,stock_quantity,stock,has_condition_offers,has_variants,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector,view_count,created_at)
SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001','bulk tablet '||i,'Brand '||i,'active',i*1000,'new',true,0,9,false,false,'bulk tablet '||i,'bulktablet'||i,to_tsvector('simple','bulk tablet '||i),to_tsvector('simple','bulk tablet '||i),i,now()+i*interval '1 second' FROM generate_series(1,130) i;
-- Serialized inventory must use public unit availability, not stale scalar stock.
CREATE TABLE public.fixture_serialized_counts(product_id uuid,variant_id uuid,public_available_units integer);
CREATE OR REPLACE FUNCTION public.get_public_serialized_variant_availability_counts(uuid,uuid[],uuid DEFAULT NULL) RETURNS TABLE(variant_id uuid,public_available_units integer) LANGUAGE sql AS $$ SELECT c.variant_id,c.public_available_units FROM public.fixture_serialized_counts c WHERE c.product_id=ANY($2) $$;
INSERT INTO public.products(id,merchant_id,name,brand,status,price,condition,manage_stock,stock_quantity,inventory_tracking_policy,has_condition_offers,has_variants,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector)
VALUES ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','serial device','Serial','active',100,'new',true,0,'serialized_strict',false,true,'serial device','serialdevice',to_tsvector('simple','serial device'),to_tsvector('simple','serial device'));
INSERT INTO public.product_variants VALUES ('20000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','new',100,9,'serialized_strict',false),('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','used',200,0,'serialized_strict',false);
INSERT INTO public.fixture_serialized_counts VALUES ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010',0),('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011',1);

-- A nullable management flag does not imply unlimited inventory.
UPDATE public.products SET stock_quantity=1 WHERE id='00000000-0000-4000-8000-000000000004';
