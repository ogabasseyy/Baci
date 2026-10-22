-- Frozen, merchant-scoped Jumia Gaming selection snapshots. Membership and
-- source-version capture share one SQL statement/snapshot; no provider writes
-- or publishing state is introduced by this contract.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.jumia_product_export_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  source_category_id uuid NOT NULL,
  captured_by uuid NOT NULL,
  captured_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  total_items integer NOT NULL DEFAULT 0,
  CONSTRAINT jumia_product_export_selections_total_nonnegative
    CHECK (total_items >= 0),
  CONSTRAINT jumia_product_export_selections_expiry_after_capture
    CHECK (expires_at > captured_at),
  CONSTRAINT jumia_product_export_selections_source_category_nonnull
    CHECK (source_category_id IS NOT NULL),
  CONSTRAINT jumia_product_export_selections_id_merchant_unique
    UNIQUE (id, merchant_id)
);

CREATE INDEX jumia_product_export_selections_merchant_expiry_idx
  ON public.jumia_product_export_selections (merchant_id, expires_at, id);

CREATE TABLE public.jumia_product_export_selection_items (
  selection_id uuid NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  ordinal integer NOT NULL,
  source_version text NOT NULL,
  PRIMARY KEY (selection_id, product_id),
  CONSTRAINT jumia_product_export_selection_items_selection_merchant_fk
    FOREIGN KEY (selection_id, merchant_id)
    REFERENCES public.jumia_product_export_selections (id, merchant_id)
    ON DELETE CASCADE,
  CONSTRAINT jumia_product_export_selection_items_ordinal_positive
    CHECK (ordinal > 0),
  CONSTRAINT jumia_product_export_selection_items_source_version_sha256
    CHECK (source_version ~ '^[0-9a-f]{64}$'),
  CONSTRAINT jumia_product_export_selection_items_ordinal_unique
    UNIQUE (selection_id, ordinal)
);

CREATE INDEX jumia_product_export_selection_items_page_idx
  ON public.jumia_product_export_selection_items (merchant_id, selection_id, ordinal);

CREATE INDEX jumia_product_export_selection_items_product_idx
  ON public.jumia_product_export_selection_items (merchant_id, product_id);

ALTER TABLE public.jumia_product_export_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jumia_product_export_selection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY jumia_product_export_selections_read_policy
  ON public.jumia_product_export_selections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = merchant_id
        AND merchant.user_id = (SELECT auth.uid())
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'integrations', 'manage'
    )
  );

CREATE POLICY jumia_product_export_selection_items_read_policy
  ON public.jumia_product_export_selection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = merchant_id
        AND merchant.user_id = (SELECT auth.uid())
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'integrations', 'manage'
    )
  );

REVOKE ALL ON public.jumia_product_export_selections
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.jumia_product_export_selection_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.jumia_product_export_selections TO authenticated;
GRANT SELECT ON public.jumia_product_export_selection_items TO authenticated;

CREATE OR REPLACE FUNCTION private.merchant_has_marketplace_sync_v1(
  p_merchant_id uuid,
  p_at timestamptz DEFAULT statement_timestamp()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(merchant.premium_features) = 'array'
              THEN merchant.premium_features
            ELSE '[]'::jsonb
          END
        ) AS feature(value)
        WHERE pg_catalog.jsonb_typeof(feature.value) = 'string'
          AND pg_catalog.lower(pg_catalog.btrim(
            feature.value #>> '{}',
            U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
          ))
            IN ('marketplace_sync', 'all_features')
      )
      OR (
        merchant.plan_tier IN ('pro', 'business', 'enterprise')
        AND (
          merchant.plan_expires_at IS NULL
          OR merchant.plan_expires_at > p_at
        )
      )
    FROM public.merchants AS merchant
    WHERE merchant.id = p_merchant_id
  ), false);
$$;

REVOKE ALL ON FUNCTION private.merchant_has_marketplace_sync_v1(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.jumia_product_export_source_projection_v1(
  p_merchant_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'product', pg_catalog.jsonb_build_object(
      'id', product.id,
      'merchantId', product.merchant_id,
      'status', product.status,
      'hasVariants', product.has_variants,
      'variantModel', product.variant_model,
      'updatedAt', product.updated_at,
      'name', product.name,
      'description', product.description,
      'sku', product.sku,
      'price', product.price,
      'stock', product.stock,
      'stockQuantity', product.stock_quantity,
      'manageStock', product.manage_stock,
      'inventoryTrackingPolicy', product.inventory_tracking_policy,
      'inventoryAnchorVariantId', product.inventory_anchor_variant_id,
      'condition', product.condition,
      'weightValue', product.weight_value,
      'weightUnit', product.weight_unit,
      'categoryId', product.category_id
    ),
    'categoryMemberships', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', membership.id,
          'name', membership.name,
          'isActive', membership.is_active
        ) ORDER BY membership.id
      )
      FROM (
        SELECT category.id, category.name, category.is_active
        FROM public.categories AS category
        WHERE category.id = product.category_id
          AND category.merchant_id = p_merchant_id
        UNION
        SELECT category.id, category.name, category.is_active
        FROM public.product_categories AS product_category
        JOIN public.categories AS category
          ON category.id = product_category.category_id
        WHERE product_category.product_id = product.id
          AND category.merchant_id = p_merchant_id
      ) AS membership
    ), '[]'::jsonb),
    'variants', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', variant.id,
          'attributes', variant.attributes,
          'sku', variant.sku,
          'priceOverride', variant.price_override,
          'stockQuantity', variant.stock_quantity,
          'inventoryTrackingPolicy', variant.inventory_tracking_policy,
          'condition', variant.condition,
          'updatedAt', variant.updated_at,
          'isInventoryAnchor', COALESCE(variant.is_inventory_anchor, false)
        ) ORDER BY variant.id
      )
      FROM public.product_variants AS variant
      WHERE variant.product_id = product.id
        AND variant.merchant_id = p_merchant_id
    ), '[]'::jsonb),
    'images', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', feed_image.id,
          'variantId', feed_image.variant_id,
          'status', feed_image.status,
          'verifiedUrl', CASE
            WHEN feed_image.status = 'verified' THEN feed_image.verified_url
            ELSE NULL
          END,
          'verifiedFormat', feed_image.verified_format,
          'isPrimary', feed_image.is_primary,
          'position', feed_image.position,
          'verifiedAt', feed_image.verified_at,
          'updatedAt', feed_image.updated_at
        ) ORDER BY feed_image.variant_id NULLS FIRST,
          feed_image.position, feed_image.id
      )
      FROM public.product_feed_images AS feed_image
      WHERE feed_image.merchant_id = p_merchant_id
        AND feed_image.product_id = product.id
    ), '[]'::jsonb)
  )
  FROM public.products AS product
  WHERE product.id = p_product_id
    AND product.merchant_id = p_merchant_id;
$$;

REVOKE ALL ON FUNCTION private.jumia_product_export_source_projection_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.jumia_product_export_source_version_v1(
  p_merchant_id uuid,
  p_product_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN projection.value IS NULL THEN NULL
    ELSE pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(projection.value::text, 'UTF8'), 'sha256'
      ),
      'hex'
    )
  END
  FROM (
    SELECT private.jumia_product_export_source_projection_v1(
      p_merchant_id, p_product_id
    ) AS value
  ) AS projection;
$$;

REVOKE ALL ON FUNCTION private.jumia_product_export_source_version_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_jumia_product_export_selection(
  p_merchant_id uuid,
  p_source_category_id uuid
)
RETURNS TABLE (
  selection_id uuid,
  total integer,
  captured_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR p_merchant_id IS NULL OR p_source_category_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to create Jumia selection'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id
        AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to create Jumia selection'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.merchant_has_marketplace_sync_v1(
    p_merchant_id, pg_catalog.statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'Marketplace sync entitlement required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH capture_clock AS MATERIALIZED (
    SELECT pg_catalog.statement_timestamp() AS captured_at
  ),
  gaming_category AS MATERIALIZED (
    SELECT category.id, category.merchant_id
    FROM public.categories AS category
    WHERE category.id = p_source_category_id
      AND category.merchant_id = p_merchant_id
      AND category.is_active = true
      AND pg_catalog.lower(pg_catalog.btrim(category.name)) = 'gaming'
  ),
  matching_products AS MATERIALIZED (
    SELECT product.id, gaming_category.id AS source_category_id
    FROM gaming_category
    JOIN public.products AS product
      ON product.merchant_id = gaming_category.merchant_id
     AND product.status = 'active'
    WHERE product.category_id = gaming_category.id
      OR EXISTS (
        SELECT 1
        FROM public.product_categories AS product_category
        WHERE product_category.product_id = product.id
          AND product_category.category_id = gaming_category.id
      )
  ),
  created_selection AS (
    INSERT INTO public.jumia_product_export_selections AS inserted_selection (
      merchant_id,
      source_category_id,
      captured_by,
      captured_at,
      expires_at,
      total_items
    )
    SELECT
      p_merchant_id,
      gaming_category.id,
      v_user_id,
      capture_clock.captured_at,
      capture_clock.captured_at + interval '24 hours',
      (SELECT pg_catalog.count(*)::integer FROM matching_products)
    FROM gaming_category
    CROSS JOIN capture_clock
    RETURNING inserted_selection.id, inserted_selection.merchant_id,
      inserted_selection.source_category_id, inserted_selection.captured_at,
      inserted_selection.expires_at, inserted_selection.total_items
  ),
  inserted_items AS (
    INSERT INTO public.jumia_product_export_selection_items AS inserted_item (
      selection_id, merchant_id, product_id, ordinal, source_version
    )
    SELECT
      created_selection.id,
      created_selection.merchant_id,
      matching_products.id,
      pg_catalog.row_number() OVER (ORDER BY matching_products.id)::integer,
      private.jumia_product_export_source_version_v1(
        created_selection.merchant_id, matching_products.id
      )
    FROM created_selection
    JOIN matching_products
      ON matching_products.source_category_id = created_selection.source_category_id
    RETURNING inserted_item.selection_id
  )
  SELECT created_selection.id,
    created_selection.total_items,
    created_selection.captured_at,
    created_selection.expires_at
  FROM created_selection
  LEFT JOIN inserted_items ON inserted_items.selection_id = created_selection.id
  GROUP BY created_selection.id, created_selection.total_items,
    created_selection.captured_at, created_selection.expires_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive canonical Gaming category'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_jumia_product_export_selection(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_jumia_product_export_selection(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.create_jumia_product_export_selection(uuid, uuid) IS
  'Atomically captures active direct and junction Gaming-category membership plus canonical source-version digests for one merchant.';

NOTIFY pgrst, 'reload schema';
