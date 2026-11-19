-- Compatibility stage: deploy before the web/mobile read-path release.
-- This does NOT revoke products.cost_price yet. See the explicit cutover in
-- supabase/operations/revoke-products-cost-price.sql after client verification.
BEGIN;

-- Match permissionGrantsAccess in app code: broader grants (full_access.all,
-- *:*, *:action, resource:*, resource:all) grant access even when the specific
-- action key is false (COALESCE stopped at explicit false).
CREATE OR REPLACE FUNCTION public.check_staff_permission(
  p_user_id uuid,
  p_merchant_id uuid,
  p_resource text,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  RETURN (
    COALESCE((v_staff_permissions -> 'full_access' ->> 'all')::boolean, false)
    OR COALESCE((v_staff_permissions -> '*' ->> '*')::boolean, false)
    OR COALESCE((v_staff_permissions -> '*' ->> p_action)::boolean, false)
    OR COALESCE((v_staff_permissions -> p_resource ->> '*')::boolean, false)
    OR COALESCE((v_staff_permissions -> p_resource ->> 'all')::boolean, false)
    OR COALESCE((v_staff_permissions -> p_resource ->> p_action)::boolean, false)
  );
END;
$$;

-- RLS cannot hide a column on otherwise public product rows. This read-only
-- owner-rights view has its own caller-bound authorization predicate. Do not
-- enable security_invoker: the caller will intentionally lose cost SELECT.
-- Expand the current catalog into explicit columns (including existing FK
-- columns, so PostgREST can infer embedded product relationships).
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_attribute AS a
  WHERE a.attrelid = 'public.products'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'products schema is missing';
  END IF;

  EXECUTE format(
    'CREATE VIEW public.merchant_products WITH (security_barrier = true, security_invoker = false) AS '
    'SELECT %s FROM public.products AS p '
    'WHERE public.check_staff_permission((SELECT auth.uid()), p.merchant_id, ''products'', ''view'')',
    v_columns
  );
END;
$$;

-- Supabase default privileges can otherwise make an updatable view writable.
-- Writes must continue through products and its existing write RLS policies.
REVOKE ALL ON TABLE public.merchant_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_products TO authenticated;
COMMENT ON VIEW public.merchant_products IS
  'Read-only product projection for the owner or active staff with products:view. Contains private cost prices; never use for public storefront reads.';

CREATE VIEW public.merchant_analytics_product_costs
WITH (security_barrier = true, security_invoker = false) AS
SELECT p.id, p.merchant_id, p.cost_price
FROM public.products AS p
WHERE public.check_staff_permission((SELECT auth.uid()), p.merchant_id, 'products', 'view')
   OR public.check_staff_permission((SELECT auth.uid()), p.merchant_id, 'analytics', 'view')
   OR public.check_staff_permission((SELECT auth.uid()), p.merchant_id, 'orders', 'edit');

REVOKE ALL ON TABLE public.merchant_analytics_product_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_analytics_product_costs TO authenticated;
COMMENT ON VIEW public.merchant_analytics_product_costs IS
  'Read-only product cost projection for the owner or active staff with products:view, analytics:view, or orders:edit. Excludes catalog fields; never use for public storefront reads.';

NOTIFY pgrst, 'reload schema';
COMMIT;
