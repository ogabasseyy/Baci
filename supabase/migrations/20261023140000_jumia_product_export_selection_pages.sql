CREATE OR REPLACE FUNCTION public.get_jumia_product_export_selection_page(
  p_selection_id uuid,
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_merchant_id uuid;
  v_captured_at timestamptz;
  v_expires_at timestamptz;
  v_source_category_id uuid;
  v_total integer;
  v_legacy_unmapped_count integer;
  v_products jsonb;
BEGIN
  IF v_user_id IS NULL OR p_selection_id IS NULL
    OR p_page IS NULL OR p_page < 1 OR p_page > 100000 OR p_limit IS NULL
    OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid Jumia selection page request'
      USING ERRCODE = '22023';
  END IF;

  SELECT selection.merchant_id, selection.source_category_id,
    selection.captured_at, selection.expires_at, selection.total_items
  INTO v_merchant_id, v_source_category_id, v_captured_at, v_expires_at, v_total
  FROM public.jumia_product_export_selections AS selection
  WHERE selection.id = p_selection_id;

  IF NOT FOUND OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = v_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, v_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Jumia selection not found'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.merchant_has_marketplace_sync_v1(
    v_merchant_id, pg_catalog.statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'Marketplace sync entitlement required'
      USING ERRCODE = '42501';
  END IF;

  IF v_expires_at <= pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'Jumia selection expired'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_legacy_unmapped_count
  FROM public.products AS legacy_product
  WHERE legacy_product.merchant_id = v_merchant_id
    AND legacy_product.status = 'active'
    AND legacy_product.category_id IS NULL
    AND pg_catalog.lower(pg_catalog.btrim(legacy_product.category)) = 'gaming'
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_categories AS membership
      JOIN public.categories AS category
        ON category.id = membership.category_id
       AND category.merchant_id = v_merchant_id
      WHERE membership.product_id = legacy_product.id
        AND category.id = v_source_category_id
    );

  SELECT COALESCE(pg_catalog.jsonb_agg(page.product_row ORDER BY page.ordinal), '[]'::jsonb)
  INTO v_products
  FROM (
    SELECT item.ordinal,
      pg_catalog.jsonb_build_object(
        'id', item.product_id,
        'ordinal', item.ordinal,
        'capturedSourceVersion', item.source_version,
        'currentSourceVersion', CASE
          WHEN product.id IS NULL THEN NULL
          ELSE private.jumia_product_export_source_version_v1(
            v_merchant_id, item.product_id
          )
        END,
        'available', product.status = 'active'
          AND current_category.id IS NOT NULL
          AND membership.in_source_category,
        'unavailableReason', CASE
          WHEN product.id IS NULL THEN 'deleted'
          WHEN product.status <> 'active' THEN 'inactive'
          WHEN current_category.id IS NULL THEN 'category_unavailable'
          WHEN NOT membership.in_source_category THEN 'category_changed'
          ELSE NULL
        END,
        'product', CASE
          WHEN product.status = 'active' AND current_category.id IS NOT NULL
            AND membership.in_source_category
          THEN private.jumia_product_export_source_projection_v1(
            v_merchant_id, item.product_id
          )
          ELSE NULL
        END
      ) AS product_row
    FROM public.jumia_product_export_selection_items AS item
    LEFT JOIN public.products AS product
      ON product.id = item.product_id
     AND product.merchant_id = v_merchant_id
    LEFT JOIN public.categories AS current_category
      ON current_category.id = v_source_category_id
     AND current_category.merchant_id = v_merchant_id
     AND current_category.is_active = true
     AND pg_catalog.lower(pg_catalog.btrim(current_category.name)) = 'gaming'
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        product.category_id = v_source_category_id
          OR EXISTS (
            SELECT 1 FROM public.product_categories AS current_membership
            WHERE current_membership.product_id = product.id
              AND current_membership.category_id = v_source_category_id
          ),
        false
      ) AS in_source_category
    ) AS membership ON true
    WHERE item.selection_id = p_selection_id
      AND item.merchant_id = v_merchant_id
      AND item.ordinal > ((p_page - 1) * p_limit)
      AND item.ordinal <= (p_page * p_limit)
  ) AS page;

  RETURN pg_catalog.jsonb_build_object(
    'selectionId', p_selection_id,
    'sourceCategoryId', v_source_category_id,
    'products', v_products,
    'total', v_total,
    'page', p_page,
    'limit', p_limit,
    'totalPages', CASE WHEN v_total = 0 THEN 0
      ELSE pg_catalog.ceil(v_total::numeric / p_limit)::integer END,
    'legacyUnmappedCount', v_legacy_unmapped_count,
    'capturedAt', v_captured_at,
    'expiresAt', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_jumia_product_export_selection_page(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_jumia_product_export_selection_page(uuid, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_jumia_product_export_selection_page(uuid, integer, integer) IS
  'Returns one bounded page of a merchant-authorized frozen Gaming selection, hydrated with current safe source projections and unavailable state.';

NOTIFY pgrst, 'reload schema';
