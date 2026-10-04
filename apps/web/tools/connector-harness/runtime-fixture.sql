-- R0 harness runtime fixture (committed test collateral).
-- Minimal application-shaped schema with EXACT policy-function bodies copied
-- from production (do not paraphrase them): if the production bodies
-- change, update this fixture and re-run the runtime suite. The real R0
-- migration is applied on top by the test runner.
-- NOTE: the orders SELECT policy here covers only the can_access_order
-- branch; production adds an inert-without-agentic-context OR branch.
-- Table grants are narrowed to authenticated SELECT (production grants
-- ALL to anon/authenticated/service_role): the policies above are the
-- enforcement point on every tested path, and no test reads as anon.
--
-- Seed: merchant M1 (owner O1) with branches B1/B2 and one order per branch;
-- merchant M2 (owner O2) with one order.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$$;

CREATE TYPE public.staff_role AS ENUM (
  'admin', 'manager', 'sales_rep', 'inventory', 'accountant',
  'customer_service', 'marketing', 'fulfillment', 'blog_manager'
);
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.branches (id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), active boolean NOT NULL DEFAULT true);
CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id),
  user_id uuid REFERENCES auth.users(id), role public.staff_role,
  permissions jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.role_permissions (
  role public.staff_role PRIMARY KEY, permissions jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE public.customers (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id),
  customer_id uuid REFERENCES public.customers(id), branch_id uuid,
  currency text DEFAULT 'NGN',
  payment_status text NOT NULL DEFAULT 'unpaid',
  shipping_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Exact copy of public.get_staff_permissions (production 2026-10-02).
CREATE OR REPLACE FUNCTION public.get_staff_permissions(p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role public.staff_role;
  v_custom_permissions jsonb;
  v_default_permissions jsonb;
  v_merchant_id uuid;
  v_staff_user_id uuid;
  v_effective_permissions jsonb;
  v_resource text;
  v_actions jsonb;
BEGIN
  IF p_staff_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT sm.role, sm.permissions, sm.merchant_id, sm.user_id
    INTO v_role, v_custom_permissions, v_merchant_id, v_staff_user_id
  FROM public.staff_members AS sm
  WHERE sm.id = p_staff_id;

  IF v_role IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Guard preserved verbatim from 20260612054548: only the staff member, the
  -- service role, or a caller with merchant access may resolve permissions.
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND (SELECT auth.uid()) IS DISTINCT FROM v_staff_user_id
    AND NOT public.has_merchant_access(v_merchant_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT rp.permissions
    INTO v_default_permissions
  FROM public.role_permissions AS rp
  WHERE rp.role = v_role;

  -- Per-resource deep merge: start from the role defaults, then for each custom
  -- resource key overlay `default_resource_object || custom_resource_object` so
  -- individual custom actions win while sibling default actions are preserved.
  -- Keys present only in defaults are kept as-is; keys present only in the
  -- custom object are added (COALESCE(... , '{}') || custom => custom).
  v_effective_permissions := COALESCE(v_default_permissions, '{}'::jsonb);

  IF v_custom_permissions IS NOT NULL THEN
    FOR v_resource, v_actions IN
      SELECT e.key, e.value
      FROM pg_catalog.jsonb_each(v_custom_permissions) AS e(key, value)
    LOOP
      v_effective_permissions := pg_catalog.jsonb_set(
        v_effective_permissions,
        ARRAY[v_resource],
        COALESCE(v_effective_permissions -> v_resource, '{}'::jsonb)
          || v_actions,
        true
      );
    END LOOP;
  END IF;

  RETURN v_effective_permissions;
END;
$function$;

-- Exact copy of public.check_staff_permission (production 2026-10-02).
CREATE OR REPLACE FUNCTION public.check_staff_permission(p_user_id uuid, p_merchant_id uuid, p_resource text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_is_owner boolean;
  v_staff_permissions jsonb;
BEGIN
  IF p_user_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.merchants AS m
    WHERE m.id = p_merchant_id
      AND m.user_id = p_user_id
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN true;
  END IF;

  SELECT public.get_staff_permissions(sm.id)
    INTO v_staff_permissions
  FROM public.staff_members AS sm
  WHERE sm.merchant_id = p_merchant_id
    AND sm.user_id = p_user_id
    AND sm.status = 'active';

  IF v_staff_permissions IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE(
    (v_staff_permissions -> '*' ->> '*')::boolean,
    (v_staff_permissions -> '*' ->> p_action)::boolean,
    (v_staff_permissions -> p_resource ->> '*')::boolean,
    (v_staff_permissions -> p_resource ->> p_action)::boolean,
    (v_staff_permissions -> p_resource ->> 'all')::boolean,
    (v_staff_permissions -> 'full_access' ->> 'all')::boolean,
    false
  );
END;
$function$;

-- Exact copy of public.has_merchant_access (baseline).
CREATE OR REPLACE FUNCTION public.has_merchant_access(p_merchant_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM merchants WHERE id = p_merchant_id AND user_id = (SELECT auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM staff_members
    WHERE merchant_id = p_merchant_id
      AND user_id = (SELECT auth.uid())
      AND status = 'active'
  );
END;
$$;

-- Exact copy of public.can_access_order (20260504010000).
CREATE OR REPLACE FUNCTION public.can_access_order(p_merchant_id uuid, p_customer_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_merchant_access(p_merchant_id)
    OR p_customer_id IN (
      SELECT id FROM public.customers WHERE user_id = (SELECT auth.uid())
    )
$$;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select_policy" ON public.orders
FOR SELECT USING (public.can_access_order(merchant_id, customer_id));
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.customers TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),
  ('dddddddd-dddd-4ddd-dddd-dddddddddddd');
INSERT INTO public.merchants (id, user_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-dddd-dddddddddddd');
INSERT INTO public.branches (id, merchant_id, active) VALUES
  ('44444444-4444-4444-a444-444444444444', '11111111-1111-4111-8111-111111111111', true),
  ('55555555-5555-4555-a555-555555555555', '11111111-1111-4111-8111-111111111111', true);
INSERT INTO public.customers (id, user_id) VALUES
  ('88888888-8888-4888-a888-888888888888', NULL);
INSERT INTO public.orders (id, merchant_id, customer_id, branch_id, payment_status, shipping_status) VALUES
  ('a0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '88888888-8888-4888-a888-888888888888', '44444444-4444-4444-a444-444444444444', 'paid', 'processing'),
  ('a0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '88888888-8888-4888-a888-888888888888', '55555555-5555-4555-a555-555555555555', 'unpaid', 'pending'),
  ('a0000000-0000-4000-a000-000000000003', '22222222-2222-4222-8222-222222222222', '88888888-8888-4888-a888-888888888888', NULL, 'paid', 'shipped');

-- R1 inventory/analytics extension (minimal real-shaped tables).
-- Column names/types mirror production (baseline + branch_scope_foundation);
-- SELECT policies copy the production bodies for these tables verbatim.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total numeric(10,2) NOT NULL DEFAULT 0;
UPDATE public.orders SET total = 150.00
  WHERE id = 'a0000000-0000-4000-a000-000000000001';
UPDATE public.orders SET total = 75.50
  WHERE id = 'a0000000-0000-4000-a000-000000000002';
UPDATE public.orders SET total = 999.00
  WHERE id = 'a0000000-0000-4000-a000-000000000003';

CREATE TABLE public.products (
  id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id),
  name text NOT NULL, status text NOT NULL DEFAULT 'draft',
  manage_stock boolean NOT NULL DEFAULT true,
  low_stock_threshold integer NOT NULL DEFAULT 5
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY, product_id uuid REFERENCES public.products(id),
  merchant_id uuid REFERENCES public.merchants(id),
  sku text, stock_quantity integer NOT NULL DEFAULT 0
);
CREATE TABLE public.variant_inventory (
  id uuid PRIMARY KEY, variant_id uuid REFERENCES public.product_variants(id),
  merchant_id uuid REFERENCES public.merchants(id),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  identifier_type text NOT NULL, identifier_value text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  order_id uuid REFERENCES public.orders(id),
  sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "variant_inventory_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'sold'::text, 'reserved'::text, 'defective'::text, 'returned'::text])))
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select_policy" ON public.products
FOR SELECT USING (((status = 'active'::text) OR public.has_merchant_access(merchant_id)));
GRANT SELECT ON public.products TO authenticated;

-- Exact copy of the production product_variants SELECT policy
-- (snapshot 2026-10-02): owner rows plus staff with orders/edit,
-- products/view, products/edit, or products/manage_inventory.
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_variants_select_by_merchant_access" ON public.product_variants
FOR SELECT TO authenticated USING (((merchant_id IN (SELECT m.id
  FROM public.merchants m
  WHERE (m.user_id = (SELECT auth.uid() AS uid)))) OR public.check_staff_permission((SELECT auth.uid() AS uid), merchant_id, 'orders', 'edit') OR public.check_staff_permission((SELECT auth.uid() AS uid), merchant_id, 'products', 'view') OR public.check_staff_permission((SELECT auth.uid() AS uid), merchant_id, 'products', 'edit') OR public.check_staff_permission((SELECT auth.uid() AS uid), merchant_id, 'products', 'manage_inventory')));
GRANT SELECT ON public.product_variants TO authenticated;

-- Exact mirror of the R1 inventory member-read migration
-- (20261003120000): merchant-scoped member SELECT with a column-scoped
-- grant. Production pre-R1 has no policy here (service_role reads
-- only); the fixture represents the post-migration state the connector
-- requires, so inventory tests cannot pass vacuously.
ALTER TABLE public.variant_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variant_inventory_member_select" ON public.variant_inventory
FOR SELECT TO authenticated USING (public.has_merchant_access(merchant_id));
GRANT SELECT (id, variant_id, merchant_id, branch_id, status)
  ON public.variant_inventory TO authenticated;

-- Production grants authenticated read access on merchants (row-limited by
-- RLS there); the owner-only policies above evaluate merchants as the
-- caller, so the fixture needs the same table grant. Fixture merchants
-- carries only id/user_id and is never served by the gateway.
GRANT SELECT ON public.merchants TO authenticated;

INSERT INTO public.products (id, merchant_id, name, status, low_stock_threshold) VALUES
  ('b0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', 'Fixture Phone', 'active', 5),
  ('b0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', 'Fixture Case', 'active', 2),
  ('b0000000-0000-4000-a000-000000000003', '22222222-2222-4222-8222-222222222222', 'Foreign Phone', 'active', 5);
INSERT INTO public.product_variants (id, product_id, merchant_id, sku) VALUES
  ('c0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', 'SKU-V1'),
  ('c0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', 'SKU-V2'),
  ('c0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000003', '22222222-2222-4222-8222-222222222222', 'SKU-V3');
INSERT INTO public.variant_inventory
  (id, variant_id, merchant_id, branch_id, identifier_type, identifier_value, status, order_id) VALUES
  ('d0000000-0000-4000-a000-000000000001', 'c0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'imei', 'IMEI-001', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000002', 'c0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'imei', 'IMEI-002', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000003', 'c0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'imei', 'IMEI-003', 'sold', 'a0000000-0000-4000-a000-000000000001'),
  ('d0000000-0000-4000-a000-000000000004', 'c0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-a555-555555555555', 'imei', 'IMEI-004', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000005', 'c0000000-0000-4000-a000-000000000001', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-a555-555555555555', 'imei', 'IMEI-005', 'reserved', NULL),
  ('d0000000-0000-4000-a000-000000000101', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-101', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000102', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-102', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000103', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-103', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000104', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-104', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000105', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-105', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000106', 'c0000000-0000-4000-a000-000000000002', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-a444-444444444444', 'serial', 'SER-106', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000201', 'c0000000-0000-4000-a000-000000000003', '22222222-2222-4222-8222-222222222222', NULL, 'imei', 'IMEI-F1', 'available', NULL),
  ('d0000000-0000-4000-a000-000000000202', 'c0000000-0000-4000-a000-000000000003', '22222222-2222-4222-8222-222222222222', NULL, 'imei', 'IMEI-F2', 'available', NULL);
