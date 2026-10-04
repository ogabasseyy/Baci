-- Disposable database fixture only. Never apply to a deployed database.
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,is_published boolean);
CREATE TABLE public.categories(id uuid PRIMARY KEY,merchant_id uuid,name text,is_active boolean);
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid,price numeric,condition text,manage_stock boolean,stock integer,stock_quantity integer,inventory_tracking_policy text,has_condition_offers boolean,has_variants boolean,status text,brand text,category text,category_id uuid,view_count bigint,created_at timestamptz,search_name_norm text,search_name_compact text,search_doc_vector tsvector,search_identify_vector tsvector,sku text,average_rating double precision,specifications jsonb);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,condition text,price_override numeric,stock_quantity integer,is_inventory_anchor boolean,inventory_tracking_policy text);
CREATE TABLE public.product_offers(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,status text,condition text,price numeric,stock_quantity integer);
CREATE FUNCTION public.normalize_product_search_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim($1)) $$;
CREATE FUNCTION public.compact_product_search_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT replace(lower(btrim($1)), ' ', '') $$;
CREATE FUNCTION public.get_public_serialized_variant_availability_counts(uuid,uuid[]) RETURNS TABLE(variant_id uuid,public_available_units integer) LANGUAGE sql AS $$ SELECT NULL::uuid,0 WHERE false $$;
GRANT SELECT ON public.products,public.merchants,public.categories TO anon,authenticated;
INSERT INTO merchants VALUES ('11111111-1111-4111-8111-111111111111',true);
INSERT INTO categories VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Phones',true);
INSERT INTO products(id,merchant_id,price,condition,manage_stock,stock,stock_quantity,has_variants,status,brand,category_id,created_at,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector,view_count,specifications)
SELECT md5('p'||n)::uuid,'11111111-1111-4111-8111-111111111111',100,'new',true,1,1,false,'active','Apple','22222222-2222-4222-8222-222222222222',now(),'fixture phone '||n,'fixturephone'||n,to_tsvector('simple','fixture phone'),to_tsvector('simple','fixture phone'),0,'{"processor":"Apple M1"}'::jsonb FROM generate_series(1,145) n;
INSERT INTO products(id,merchant_id,price,condition,manage_stock,stock,stock_quantity,has_variants,status,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector,created_at)
VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',999,'new',true,0,0,false,'active','fixture sold phone','fixturesoldphone',to_tsvector('simple','fixture phone'),to_tsvector('simple','fixture phone'),now()),
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',999,'new',false,100,100,true,'active','fixture missing variant phone','fixturemissingvariantphone',to_tsvector('simple','fixture phone'),to_tsvector('simple','fixture phone'),now());

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_publication ON public.products FOR SELECT USING (status='active' AND EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.is_published));
GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated;
INSERT INTO merchants VALUES ('55555555-5555-4555-8555-555555555555',false);
INSERT INTO products(id,merchant_id,price,status,manage_stock,has_variants,search_name_norm,search_name_compact,search_doc_vector,search_identify_vector)
VALUES ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555',100,'active',false,false,'fixture phone','fixturephone',to_tsvector('simple','fixture phone'),to_tsvector('simple','fixture phone'));

-- Final option-projection regressions: null management, independent base,
-- and no standalone condition offers on products with required variants.
INSERT INTO products(id,merchant_id,price,status,manage_stock,stock,has_variants,has_condition_offers)
VALUES ('77777777-7777-4777-8777-777777777771','11111111-1111-4111-8111-111111111111',100,'active',NULL,0,false,false),
('77777777-7777-4777-8777-777777777772','11111111-1111-4111-8111-111111111111',100,'active',true,1,false,true),
('77777777-7777-4777-8777-777777777773','11111111-1111-4111-8111-111111111111',100,'active',true,1,true,true);
INSERT INTO product_offers(id,product_id,merchant_id,status,condition,price,stock_quantity)
VALUES ('88888888-8888-4888-8888-888888888882','77777777-7777-4777-8777-777777777772','11111111-1111-4111-8111-111111111111','active','used',50,1),
('88888888-8888-4888-8888-888888888883','77777777-7777-4777-8777-777777777773','11111111-1111-4111-8111-111111111111','active','used',50,1);
INSERT INTO product_variants(id,product_id,merchant_id,condition,price_override,stock_quantity,is_inventory_anchor)
VALUES ('99999999-9999-4999-8999-999999999993','77777777-7777-4777-8777-777777777773','11111111-1111-4111-8111-111111111111','new',250,1,false);
