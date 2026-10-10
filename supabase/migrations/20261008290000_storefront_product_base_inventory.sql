-- Append-only: expose the base option's effective policy + units for simple products.
--
-- Refined search advertises a non-variant product when its inventory anchor
-- carries serialized_then_unlimited, or serialized_strict with available
-- units, even while the scalar stock is zero. Native PDP hydration reads
-- the products row plus the non-anchor variants RPC, so neither source
-- carries the anchor's policy or units and the advertised base option opens
-- as out of stock. This narrow RPC projects exactly that pair per product:
-- the anchor-first effective policy (mirroring the price-options anchor
-- CTE) and the base-row available units (variant_id IS NULL row of the
-- approved availability counter, 0 when absent). Visibility, batching, and
-- grants mirror get_storefront_product_variants exactly, including the
-- published-or-admin public branch with unpublished admin exclusion.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_storefront_product_base_inventory(
  p_product_ids uuid[]
)
RETURNS TABLE(
  product_id uuid,
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
      'get_storefront_product_base_inventory supports at most 10000 product IDs (received %)',
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
    WHERE COALESCE(m.is_published, FALSE) IS TRUE
       OR COALESCE(m.is_platform_admin, FALSE) IS TRUE
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
      AND COALESCE(m.is_platform_admin, FALSE) IS NOT TRUE
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
  anchor_policy AS MATERIALIZED (
    SELECT
      rp.id AS product_id,
      COALESCE(
        (
          SELECT CASE
            WHEN av.inventory_tracking_policy IN (
              'off',
              'serialized_strict',
              'serialized_then_unlimited'
            )
            THEN av.inventory_tracking_policy
          END
          FROM public.product_variants AS av
          WHERE av.product_id = rp.id
            AND av.merchant_id = rp.merchant_id
            AND av.is_inventory_anchor IS TRUE
          ORDER BY av.id
          LIMIT 1
        ),
        rp.inventory_tracking_policy,
        'legacy'
      ) AS effective_policy
    FROM requested_products AS rp
  ),
  serialized_units AS MATERIALIZED (
    SELECT s.product_id, s.public_available_units
    FROM authorized_merchants AS am2
    CROSS JOIN LATERAL public.get_public_serialized_variant_availability_counts(
      am2.id,
      ARRAY(SELECT rp2.id FROM requested_products AS rp2
            WHERE rp2.merchant_id = am2.id)
    ) AS s
    WHERE s.variant_id IS NULL
  )
  SELECT
    ap.product_id,
    ap.effective_policy,
    COALESCE(su.public_available_units, 0) AS available_units
  FROM requested_products AS rp
  JOIN authorized_merchants AS am
    ON am.id = rp.merchant_id
  JOIN anchor_policy AS ap
    ON ap.product_id = rp.id
  LEFT JOIN serialized_units AS su
    ON su.product_id = rp.id
  ORDER BY ap.product_id;
END;
$$;

ALTER FUNCTION public.get_storefront_product_base_inventory(uuid[]) OWNER TO postgres;

COMMENT ON FUNCTION public.get_storefront_product_base_inventory(uuid[]) IS
  'Returns the base-option effective policy and available units for batches of at most 10000 active products, including authorized owner/staff preview of unpublished merchants.';

REVOKE ALL ON FUNCTION public.get_storefront_product_base_inventory(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_product_base_inventory(uuid[])
  TO anon, authenticated, service_role;

COMMIT;
