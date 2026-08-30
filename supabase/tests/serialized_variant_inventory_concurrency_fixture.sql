-- PostgreSQL concurrency regression for serialized release lock ordering.
-- The fixture keeps only the production tables and trigger path needed to
-- reproduce cross-product lock inversion in two independent sessions.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  fulfillment_details jsonb,
  branch_id uuid,
  payment_status text,
  payment_method text
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid,
  quantity integer NOT NULL,
  fulfillment_data jsonb
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  has_variants boolean NOT NULL DEFAULT true,
  variant_model text NOT NULL DEFAULT 'sku_matrix',
  inventory_tracking_policy text NOT NULL DEFAULT 'off',
  inventory_anchor_variant_id uuid,
  stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  merchant_id uuid,
  inventory_tracking_policy text NOT NULL DEFAULT 'inherit',
  is_inventory_anchor boolean NOT NULL DEFAULT false,
  stock_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.variant_inventory (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  order_id uuid,
  order_item_id uuid,
  branch_id uuid,
  merchant_id uuid NOT NULL,
  status text NOT NULL,
  identifier_type text,
  identifier_value text,
  sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  first_reserved_at timestamptz,
  reserved_at timestamptz,
  reservation_expires_at timestamptz,
  source text NOT NULL DEFAULT 'merchant_stock',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.inventory_product_locks (
  product_id uuid PRIMARY KEY,
  touched_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION private.sync_serialized_stock(
  p_merchant_id uuid,
  p_product_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE private.inventory_product_locks
  SET touched_at = clock_timestamp()
  WHERE product_id = p_product_id;
  PERFORM pg_sleep(0.25);
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_variant_inventory_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  SELECT product_id INTO v_product_id
  FROM public.product_variants
  WHERE id = NEW.variant_id;
  PERFORM private.sync_serialized_stock(NEW.merchant_id, v_product_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_variant_inventory_stock
AFTER UPDATE OF status ON public.variant_inventory
FOR EACH ROW EXECUTE FUNCTION private.sync_variant_inventory_stock();

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'service_role'::text;
$$;

CREATE OR REPLACE FUNCTION public.has_merchant_access(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION private.record_variant_inventory_event(
  p_unit_id uuid,
  p_merchant_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_order_id uuid,
  p_order_item_id uuid,
  p_branch_id uuid,
  p_reserved_at timestamptz,
  p_expires_at timestamptz,
  p_metadata jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  NULL;
END;
$$;

-- The production migration replaces this placeholder with the function under
-- test. Keeping the signature here lets the fixture apply that migration
-- exactly as the real database does.
CREATE OR REPLACE FUNCTION private.release_order_inventory_units(
  p_merchant_id uuid,
  p_order_id uuid,
  p_target_status text DEFAULT 'available'
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION private.try_release(
  p_merchant_id uuid,
  p_order_id uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM private.release_order_inventory_units(
    p_merchant_id,
    p_order_id,
    'available'
  );
  RETURN 'succeeded';
EXCEPTION WHEN OTHERS THEN
  RETURN format('error:%s', SQLERRM);
END;
$$;

INSERT INTO public.orders (id, merchant_id) VALUES
  ('00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f201'),
  ('00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f201');

INSERT INTO public.products (id, merchant_id, inventory_tracking_policy) VALUES
  ('00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f301', 'serialized_strict'),
  ('00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f301', 'serialized_strict'),
  ('00000000-0000-4000-8000-00000000f334', '00000000-0000-4000-8000-00000000f301', 'serialized_strict');

INSERT INTO public.product_variants (id, product_id) VALUES
  ('00000000-0000-4000-8000-00000000f206', '00000000-0000-4000-8000-00000000f204'),
  ('00000000-0000-4000-8000-00000000f207', '00000000-0000-4000-8000-00000000f205');

INSERT INTO public.product_variants (
  id, product_id, merchant_id, inventory_tracking_policy
) VALUES
  ('00000000-0000-4000-8000-00000000f306', '00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f301', 'inherit'),
  ('00000000-0000-4000-8000-00000000f316', '00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f301', 'inherit'),
  ('00000000-0000-4000-8000-00000000f336', '00000000-0000-4000-8000-00000000f334', '00000000-0000-4000-8000-00000000f301', 'inherit');

INSERT INTO public.order_items (id, order_id, product_id, quantity) VALUES
  ('00000000-0000-4000-8000-00000000f20c', '00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f205', 1),
  ('00000000-0000-4000-8000-00000000f20d', '00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f204', 1),
  ('00000000-0000-4000-8000-00000000f20e', '00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f204', 1),
  ('00000000-0000-4000-8000-00000000f20f', '00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f205', 1);

INSERT INTO public.orders (
  id, merchant_id, payment_status, payment_method
) VALUES
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-4000-8000-00000000f301', 'pending', 'card'),
  ('00000000-0000-4000-8000-00000000f303', '00000000-0000-4000-8000-00000000f301', 'pending', 'card'),
  ('00000000-0000-4000-8000-00000000f312', '00000000-0000-4000-8000-00000000f301', 'paid', 'card'),
  ('00000000-0000-4000-8000-00000000f313', '00000000-0000-4000-8000-00000000f301', 'paid', 'card'),
  ('00000000-0000-4000-8000-00000000f322', '00000000-0000-4000-8000-00000000f301', 'paid', 'card'),
  ('00000000-0000-4000-8000-00000000f332', '00000000-0000-4000-8000-00000000f301', 'paid', 'card'),
  ('00000000-0000-4000-8000-00000000f342', '00000000-0000-4000-8000-00000000f301', 'paid', 'card');

INSERT INTO public.order_items (
  id, order_id, product_id, variant_id, quantity
) VALUES
  ('00000000-0000-4000-8000-00000000f30c', '00000000-0000-4000-8000-00000000f302', '00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f306', 1),
  ('00000000-0000-4000-8000-00000000f30d', '00000000-0000-4000-8000-00000000f303', '00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f306', 1),
  ('00000000-0000-4000-8000-00000000f31c', '00000000-0000-4000-8000-00000000f312', '00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f316', 1),
  ('00000000-0000-4000-8000-00000000f31d', '00000000-0000-4000-8000-00000000f313', '00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f316', 1),
  ('00000000-0000-4000-8000-00000000f32c', '00000000-0000-4000-8000-00000000f322', '00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f316', 1),
  ('00000000-0000-4000-8000-00000000f33c', '00000000-0000-4000-8000-00000000f332', '00000000-0000-4000-8000-00000000f334', '00000000-0000-4000-8000-00000000f336', 2),
  ('00000000-0000-4000-8000-00000000f34c', '00000000-0000-4000-8000-00000000f342', '00000000-0000-4000-8000-00000000f304', '00000000-0000-4000-8000-00000000f306', 1),
  ('00000000-0000-4000-8000-00000000f34d', '00000000-0000-4000-8000-00000000f342', '00000000-0000-4000-8000-00000000f314', '00000000-0000-4000-8000-00000000f316', 1);

INSERT INTO private.inventory_product_locks (product_id) VALUES
  ('00000000-0000-4000-8000-00000000f204'),
  ('00000000-0000-4000-8000-00000000f205'),
  ('00000000-0000-4000-8000-00000000f304'),
  ('00000000-0000-4000-8000-00000000f314'),
  ('00000000-0000-4000-8000-00000000f334');

-- Interleave the rows so an unordered scan would make order A lock product 2
-- first while order B locks product 1 first, producing a deadlock at the
-- trigger's product-level stock synchronization lock.
INSERT INTO public.variant_inventory (id, variant_id, order_id, order_item_id, merchant_id, status) VALUES
  ('00000000-0000-4000-8000-00000000f208', '00000000-0000-4000-8000-00000000f207', '00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f20c', '00000000-0000-4000-8000-00000000f201', 'reserved'),
  ('00000000-0000-4000-8000-00000000f209', '00000000-0000-4000-8000-00000000f206', '00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f20d', '00000000-0000-4000-8000-00000000f201', 'reserved'),
  ('00000000-0000-4000-8000-00000000f20a', '00000000-0000-4000-8000-00000000f206', '00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f20e', '00000000-0000-4000-8000-00000000f201', 'reserved'),
  ('00000000-0000-4000-8000-00000000f20b', '00000000-0000-4000-8000-00000000f207', '00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f20f', '00000000-0000-4000-8000-00000000f201', 'reserved');

INSERT INTO public.variant_inventory (
  id, variant_id, merchant_id, status, identifier_type, identifier_value
) VALUES
  ('00000000-0000-4000-8000-00000000f308', '00000000-0000-4000-8000-00000000f306', '00000000-0000-4000-8000-00000000f301', 'available', 'serial', 'claim-unit-a'),
  ('00000000-0000-4000-8000-00000000f309', '00000000-0000-4000-8000-00000000f306', '00000000-0000-4000-8000-00000000f301', 'available', 'serial', 'claim-unit-b'),
  ('00000000-0000-4000-8000-00000000f318', '00000000-0000-4000-8000-00000000f316', '00000000-0000-4000-8000-00000000f301', 'available', 'serial', 'confirm-unit');

INSERT INTO public.variant_inventory (
  id, variant_id, order_id, order_item_id, merchant_id, status,
  reservation_expires_at, identifier_type, identifier_value
) VALUES (
  '00000000-0000-4000-8000-00000000f328',
  '00000000-0000-4000-8000-00000000f316',
  '00000000-0000-4000-8000-00000000f322',
  '00000000-0000-4000-8000-00000000f32c',
  '00000000-0000-4000-8000-00000000f301',
  'reserved',
  clock_timestamp() + interval '1 hour',
  'serial',
  'confirmed-sale-race-unit'
);

INSERT INTO public.variant_inventory (
  id, variant_id, order_id, order_item_id, merchant_id, status,
  reservation_expires_at, identifier_type, identifier_value
) VALUES (
  '00000000-0000-4000-8000-00000000f338',
  '00000000-0000-4000-8000-00000000f336',
  '00000000-0000-4000-8000-00000000f332',
  '00000000-0000-4000-8000-00000000f33c',
  '00000000-0000-4000-8000-00000000f301',
  'reserved',
  clock_timestamp() + interval '1 hour',
  'serial',
  'partial-confirm-sale-race-unit'
);

INSERT INTO public.variant_inventory (
  id, variant_id, order_id, order_item_id, merchant_id, status,
  reservation_expires_at, identifier_type, identifier_value
) VALUES
  ('00000000-0000-4000-8000-00000000f348', '00000000-0000-4000-8000-00000000f306', '00000000-0000-4000-8000-00000000f342', '00000000-0000-4000-8000-00000000f34c', '00000000-0000-4000-8000-00000000f301', 'reserved', clock_timestamp() + interval '1 hour', 'serial', 'cross-sale-release-unit-a'),
  ('00000000-0000-4000-8000-00000000f349', '00000000-0000-4000-8000-00000000f316', '00000000-0000-4000-8000-00000000f342', '00000000-0000-4000-8000-00000000f34d', '00000000-0000-4000-8000-00000000f301', 'reserved', clock_timestamp() + interval '1 hour', 'serial', 'cross-sale-release-unit-b');
