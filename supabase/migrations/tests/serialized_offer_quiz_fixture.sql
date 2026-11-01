CREATE SCHEMA private;
CREATE TABLE public.quiz_events (id uuid PRIMARY KEY, merchant_id uuid, contract_version integer, mode text, settings jsonb);
CREATE TABLE public.products (id uuid PRIMARY KEY, merchant_id uuid, status text, has_variants boolean, variant_model text, inventory_anchor_variant_id uuid, inventory_tracking_policy text, manage_stock boolean, stock_quantity integer);
CREATE TABLE public.product_variants (id uuid PRIMARY KEY, merchant_id uuid, product_id uuid, is_inventory_anchor boolean, inventory_tracking_policy text, stock_quantity integer);
CREATE TABLE public.variant_inventory (id uuid PRIMARY KEY, merchant_id uuid, variant_id uuid, condition_offer_id uuid, status text, order_id uuid, order_item_id uuid, sold_at timestamptz, created_at timestamptz, reserved_at timestamptz, updated_at timestamptz);
CREATE TABLE public.quiz_prize_reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, merchant_id uuid, product_id uuid, variant_id uuid, condition text, inventory_unit_id uuid, inventory_kind text, state text DEFAULT 'reserved');
CREATE FUNCTION private.ensure_product_inventory_anchor_variant(uuid, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.get_effective_inventory_tracking_policy(text,text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif($2,'inherit'),$1) $$;
INSERT INTO public.products VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','active',false,'legacy','00000000-0000-0000-0000-000000000002','serialized_strict',true,2);
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',true,'inherit',2);
INSERT INTO public.quiz_events VALUES
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',2,'live','{"prize_product_id":"00000000-0000-0000-0000-000000000001"}'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010',2,'live','{"prize_product_id":"00000000-0000-0000-0000-000000000001"}');
INSERT INTO public.variant_inventory(id,merchant_id,variant_id,condition_offer_id,status,created_at) VALUES
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099','available','2026-01-01'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002',NULL,'available','2026-01-02');
