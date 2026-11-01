DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO authenticated, service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role', true) $$;
CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1::text = current_setting('test.merchant', true) $$;
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, inventory_anchor_variant_id uuid, has_variants boolean, variant_model text);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, product_id uuid NOT NULL, is_inventory_anchor boolean);
CREATE TABLE public.product_offers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, product_id uuid NOT NULL, status text, condition text);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, variant_id uuid NOT NULL, status text, order_id uuid, order_item_id uuid, sold_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now());
INSERT INTO public.products VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002', false, 'legacy'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000012', false, 'legacy');
INSERT INTO public.product_variants VALUES
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011',true);
INSERT INTO public.product_offers VALUES
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','active','used'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','active','new');
INSERT INTO public.variant_inventory VALUES
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','available',NULL,NULL,NULL,now()),
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','reserved','00000000-0000-0000-0000-000000000099',NULL,NULL,now()),
 ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','available',NULL,NULL,NULL,now()),
 ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','available',NULL,NULL,NULL,now());
SELECT set_config('test.role','authenticated',false), set_config('test.merchant','00000000-0000-0000-0000-000000000010',false);
ALTER TABLE public.product_variants ADD COLUMN attributes jsonb DEFAULT '{}'::jsonb, ADD COLUMN condition text;
ALTER TABLE public.variant_inventory ADD COLUMN branch_id uuid, ADD COLUMN identifier_type text, ADD COLUMN identifier_value text, ADD COLUMN source text DEFAULT 'merchant_stock', ADD COLUMN first_reserved_at timestamptz, ADD COLUMN reserved_at timestamptz, ADD COLUMN reservation_expires_at timestamptz;
CREATE TABLE public.branches (id uuid PRIMARY KEY, name text);
CREATE TABLE private.variant_inventory_events (inventory_unit_id uuid, event_type text);

ALTER TABLE public.products ADD COLUMN slug text;
UPDATE public.products SET slug = 'sample-phone';
CREATE TABLE public.test_cache_targets (merchant_id uuid, product_slugs text[]);
CREATE FUNCTION public.enqueue_storefront_cache_targets(uuid, text DEFAULT NULL, text DEFAULT NULL, text[] DEFAULT '{}') RETURNS void LANGUAGE sql AS $$ INSERT INTO public.test_cache_targets VALUES ($1, $4) $$;
