-- Append-only: expose serialized policy + units on storefront variant rows.
--
-- get_storefront_product_variants carried the raw stock_quantity without
-- the effective tracking policy, so the native PDP reported an advertised
-- serialized_then_unlimited variant out of stock once its raw quantity hit
-- zero, and could not distinguish zero-unit serialized_strict rows. Two
-- additive columns mirror the public option projection exactly: the
-- inherited effective_policy ('off', 'serialized_strict', or
-- 'serialized_then_unlimited') and the public available_units count from
-- the approved availability counter (0 when the variant has no serialized
-- units). Existing columns, visibility, ordering, and grants are
-- unchanged; the merchant-scoped units lookup runs once per merchant.
-- The return type gains two columns, so the old signature is dropped
-- first: CREATE OR REPLACE cannot change a function's return type
-- (42P13).
BEGIN;

DROP FUNCTION IF EXISTS public.get_storefront_product_variants(uuid[]);

CREATE OR REPLACE FUNCTION public.get_storefront_product_variants(
  p_product_ids uuid[]
)
RETURNS TABLE(
  id uuid,
  product_id uuid,
  sku text,
  attributes jsonb,
  condition text,
  price_override numeric,
  stock_quantity integer,
  images jsonb,
  primary_image text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  effective_policy text,
  available_units integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 10000 THEN
    RAISE EXCEPTION
      'get_storefront_product_variants supports at most 10000 product IDs (received %)',
      pg_catalog.cardinality(p_product_ids)
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_products AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.inventory_tracking_policy
    FROM public.products AS p
    WHERE COALESCE(pg_catalog.cardinality(p_product_ids), 0)
      BETWEEN 1 AND 10000
      AND p.id = ANY(p_product_ids)
      AND p.status = 'active'
  ),
  requested_merchants AS MATERIALIZED (
    SELECT DISTINCT rp.merchant_id
    FROM requested_products AS rp
  ),
  published_merchants AS MATERIALIZED (
    SELECT m.id
    FROM requested_merchants AS rm
    JOIN public.merchants AS m
      ON m.id = rm.merchant_id
    WHERE COALESCE(m.is_published, FALSE)
  ),
  -- The application batches within one merchant. Retain cross-merchant public
  -- reads, but suppress unpublished preview when a direct caller mixes two or
  -- more unpublished merchants so permission checks cannot be amplified.
  unpublished_merchants AS MATERIALIZED (
    SELECT m.id, m.user_id
    FROM requested_merchants AS rm
    JOIN public.merchants AS m
      ON m.id = rm.merchant_id
    WHERE NOT COALESCE(m.is_published, FALSE)
    ORDER BY m.id
    LIMIT 2
  ),
  caller AS MATERIALIZED (
    SELECT
      (SELECT auth.uid()) AS user_id,
      COALESCE((SELECT auth.role()), '') AS role_name
  ),
  authorized_unpublished_merchants AS MATERIALIZED (
    SELECT um.id
    FROM unpublished_merchants AS um
    CROSS JOIN caller AS c
    WHERE CASE
      WHEN (SELECT pg_catalog.count(*) FROM unpublished_merchants) <> 1
        THEN FALSE
      WHEN c.role_name <> 'authenticated' THEN FALSE
      WHEN c.user_id IS NULL THEN FALSE
      WHEN um.user_id = c.user_id THEN TRUE
      ELSE
        public.check_staff_permission(
          c.user_id,
          um.id,
          'orders',
          'edit'
        )
        OR public.check_staff_permission(
          c.user_id,
          um.id,
          'products',
          'view'
        )
        OR public.check_staff_permission(
          c.user_id,
          um.id,
          'products',
          'edit'
        )
        OR public.check_staff_permission(
          c.user_id,
          um.id,
          'products',
          'manage_inventory'
        )
    END
  ),
  authorized_merchants AS MATERIALIZED (
    SELECT pm.id
    FROM published_merchants AS pm
    UNION ALL
    SELECT aum.id
    FROM authorized_unpublished_merchants AS aum
  ),
  serialized_units AS MATERIALIZED (
    SELECT s.variant_id, s.public_available_units
    FROM authorized_merchants AS am2
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(
      am2.id,
      ARRAY(SELECT rp2.id FROM requested_products AS rp2
            WHERE rp2.merchant_id = am2.id)
    ) AS s
  )
  SELECT
    pv.id,
    pv.product_id,
    pv.sku,
    pv.attributes,
    pv.condition,
    pv.price_override,
    pv.stock_quantity,
    pv.images,
    pv.primary_image,
    pv.created_at,
    pv.updated_at,
    CASE
      WHEN COALESCE(pv.inventory_tracking_policy, 'inherit')
        IN ('off', 'serialized_strict', 'serialized_then_unlimited')
        THEN COALESCE(pv.inventory_tracking_policy, 'inherit')
      WHEN COALESCE(rp.inventory_tracking_policy, 'off')
        IN ('serialized_strict', 'serialized_then_unlimited')
        THEN rp.inventory_tracking_policy
      ELSE 'off'
    END AS effective_policy,
    COALESCE(su.public_available_units, 0) AS available_units
  FROM requested_products AS rp
  JOIN authorized_merchants AS am
    ON am.id = rp.merchant_id
  JOIN public.product_variants AS pv
    ON pv.product_id = rp.id
   AND pv.merchant_id = rp.merchant_id
  LEFT JOIN serialized_units AS su
    ON su.variant_id = pv.id
  WHERE pv.is_inventory_anchor IS NOT TRUE
  ORDER BY pv.product_id, pv.created_at, pv.id;
END;
$$;


ALTER FUNCTION public.get_storefront_product_variants(uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.get_storefront_product_variants(uuid[]) IS
  'Returns public variants for batches of at most 10000 active products, including authorized owner/staff preview of unpublished merchants.';

REVOKE ALL ON FUNCTION public.get_storefront_product_variants(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_product_variants(uuid[])
  TO anon, authenticated, service_role;

COMMIT;
