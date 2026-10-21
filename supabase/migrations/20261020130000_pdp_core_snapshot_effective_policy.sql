-- Emit the anchor-derived effective policy on the PDP core snapshot's
-- product_data so snapshot consumers (v2 PDP offer pricing) can cap by
-- the strict serialized pool for simple products whose hidden anchor
-- supplies serialized tracking while the row policy is `off` (offer
-- authority check product 008). The simple_inventory_state CTE already
-- computes it for the folded stock/manage_stock fields; only the
-- emission is new.
--
-- Backwards compatible: cached snapshots without the key read undefined
-- and fall back to inventory_tracking_policy (current behavior).
--
-- Also aligns the anchor pick to lowest-id-first, matching the
-- offer-resolution authority and base-inventory anchors (previously
-- created_at-first here): single-anchor products are unaffected.
--
-- The function body below is otherwise byte-identical to the definition in
-- 20260712101000_pdp_core_slug_case_insensitive.sql.

CREATE OR REPLACE FUNCTION private.get_storefront_pdp_core_v2(
  p_merchant_id uuid,
  p_product_slug text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  resolution_status text,
  product_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH normalized_input AS (
    SELECT
      pg_catalog.lower(pg_catalog.btrim(p_product_slug)) AS product_identifier,
      CASE
        WHEN pg_catalog.lower(pg_catalog.btrim(p_product_slug)) ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN pg_catalog.lower(pg_catalog.btrim(p_product_slug))::uuid
        ELSE NULL::uuid
      END AS product_id
    WHERE p_merchant_id IS NOT NULL
      AND p_product_slug IS NOT NULL
      -- 512 matches the existing PDP preflight RPC input bound. The storefront
      -- safety gate admits decoded slugs up to 255 chars and products.slug is
      -- unbounded TEXT, so a tighter bound here would 404 routable PDPs.
      AND pg_catalog.octet_length(p_product_slug) <= 512
      AND pg_catalog.btrim(p_product_slug) <> ''
  ),
  selected_product AS MATERIALIZED (
    SELECT
      product_row.id,
      product_row.merchant_id,
      product_row.category_id,
      product_row.created_at,
      product_row.updated_at,
      product_row.name,
      product_row.description,
      product_row.status,
      product_row.price,
      product_row.compare_at_price,
      product_row.stock,
      product_row.stock_quantity,
      product_row.manage_stock,
      product_row.low_stock_threshold,
      product_row.sku,
      product_row.slug,
      product_row.condition,
      product_row.condition_detail,
      product_row.variant_model,
      product_row.default_variant_id,
      product_row.available_conditions,
      product_row.min_variant_price,
      product_row.max_variant_price,
      product_row.brand,
      product_row.category,
      product_row.color,
      product_row.has_variants,
      product_row.has_condition_offers,
      product_row.variant_attributes,
      product_row.images,
      product_row.image_hint,
      product_row.specifications,
      product_row.weight_value,
      product_row.weight_unit,
      product_row.dimensions,
      product_row.taxable,
      product_row.tax_code,
      product_row.meta_title,
      product_row.meta_description,
      product_row.keywords,
      product_row.canonical_url,
      product_row.schema_markup,
      product_row.gtin,
      product_row.mpn,
      product_row.google_product_category,
      product_row.fulfillment_fields,
      product_row.inventory_tracking_policy
    FROM normalized_input AS input
    JOIN public.products AS product_row
      ON product_row.merchant_id = p_merchant_id
      AND product_row.status = 'active'
      AND (
        pg_catalog.lower(product_row.slug) = input.product_identifier
        OR product_row.id = input.product_id
      )
    JOIN public.merchants AS merchant_row
      ON merchant_row.id = product_row.merchant_id
      AND (
        COALESCE(merchant_row.is_published, false) = true
        OR COALESCE(merchant_row.is_platform_admin, false) = true
      )
    ORDER BY
      CASE WHEN pg_catalog.lower(product_row.slug) = input.product_identifier THEN 0 ELSE 1 END,
      product_row.id
    LIMIT 1
  ),
  legacy_redirect_target AS MATERIALIZED (
    SELECT
      parent_product.id,
      parent_product.name,
      parent_product.slug,
      parent_product.status,
      parent_product.category,
      canonical_category.id AS category_id,
      canonical_category.name AS category_name,
      canonical_category.slug AS category_slug,
      canonical_category.parent_id AS category_parent_id
    FROM normalized_input AS input
    JOIN public.products AS legacy_product
      ON legacy_product.merchant_id = p_merchant_id
      AND legacy_product.status = 'archived'
      AND (
        pg_catalog.lower(legacy_product.slug) = input.product_identifier
        OR legacy_product.id = input.product_id
      )
    JOIN public.products AS parent_product
      ON parent_product.id = legacy_product.parent_product_id
      AND parent_product.merchant_id = legacy_product.merchant_id
      AND parent_product.status = 'active'
      AND NULLIF(
        pg_catalog.btrim(parent_product.slug),
        ''
      ) IS NOT NULL
    JOIN public.merchants AS merchant_row
      ON merchant_row.id = parent_product.merchant_id
      AND (
        COALESCE(merchant_row.is_published, false) = true
        OR COALESCE(merchant_row.is_platform_admin, false) = true
      )
    LEFT JOIN LATERAL (
      SELECT
        category_candidate.id,
        category_candidate.name,
        category_candidate.slug,
        category_candidate.parent_id
      FROM (
        SELECT
          direct_category.id,
          direct_category.name,
          direct_category.slug,
          direct_category.parent_id,
          0 AS category_rank
        FROM public.categories AS direct_category
        WHERE direct_category.id = parent_product.category_id
          AND direct_category.is_active IS TRUE

        UNION ALL

        SELECT
          joined_category.id,
          joined_category.name,
          joined_category.slug,
          joined_category.parent_id,
          1 AS category_rank
        FROM public.product_categories AS membership
        JOIN public.categories AS joined_category
          ON joined_category.id = membership.category_id
          AND joined_category.is_active IS TRUE
        WHERE membership.product_id = parent_product.id
      ) AS category_candidate
      ORDER BY category_candidate.category_rank, category_candidate.id
      LIMIT 1
    ) AS canonical_category ON true
    ORDER BY
      CASE WHEN pg_catalog.lower(legacy_product.slug) = input.product_identifier THEN 0 ELSE 1 END,
      legacy_product.id,
      parent_product.id
    LIMIT 1
  ),
  serialized_product_scope AS (
    SELECT product_row.id, product_row.merchant_id
    FROM selected_product AS product_row
    WHERE product_row.inventory_tracking_policy IN (
      'serialized_strict',
      'serialized_then_unlimited'
    )
      OR EXISTS (
        SELECT 1
        FROM public.product_variants AS variant_row
        WHERE variant_row.product_id = product_row.id
          AND variant_row.merchant_id = product_row.merchant_id
          AND variant_row.inventory_tracking_policy IN (
            'serialized_strict',
            'serialized_then_unlimited'
          )
      )
  ),
  availability_counts AS MATERIALIZED (
    SELECT
      availability.product_id,
      availability.variant_id,
      availability.public_available_units
    FROM serialized_product_scope AS product_row
    CROSS JOIN LATERAL private.get_public_serialized_variant_availability_counts(
      product_row.merchant_id,
      ARRAY[product_row.id]::uuid[],
      p_branch_id
    ) AS availability
  ),
  simple_inventory_state AS (
    SELECT
      product_row.id AS product_id,
      CASE
        WHEN product_row.has_variants IS TRUE THEN 'off'::text
        WHEN anchor_variant.inventory_tracking_policy IN (
          'off',
          'serialized_strict',
          'serialized_then_unlimited'
        ) THEN anchor_variant.inventory_tracking_policy
        WHEN product_row.inventory_tracking_policy IN (
          'serialized_strict',
          'serialized_then_unlimited'
        ) THEN product_row.inventory_tracking_policy
        ELSE 'off'::text
      END AS effective_policy,
      COALESCE(availability.public_available_units, 0) AS available_units
    FROM selected_product AS product_row
    LEFT JOIN LATERAL (
      SELECT variant_row.inventory_tracking_policy
      FROM public.product_variants AS variant_row
      WHERE variant_row.product_id = product_row.id
        AND variant_row.merchant_id = product_row.merchant_id
        AND variant_row.is_inventory_anchor IS TRUE
      -- Lowest anchor id wins (aligned with the offer-resolution
      -- authority and base-inventory anchors): multi-anchor products
      -- are a data anomaly, but every surface must pick the same one.
      ORDER BY variant_row.id
      LIMIT 1
    ) AS anchor_variant ON true
    LEFT JOIN availability_counts AS availability
      ON availability.product_id = product_row.id
      AND availability.variant_id IS NULL
  ),
  variant_population AS MATERIALIZED (
    SELECT pg_catalog.count(variant_row.id)::integer AS total_count
    FROM selected_product AS product_row
    JOIN public.product_variants AS variant_row
      ON variant_row.product_id = product_row.id
      AND variant_row.merchant_id = product_row.merchant_id
      AND variant_row.is_inventory_anchor IS NOT TRUE
  ),
  variant_source AS MATERIALIZED (
    SELECT
      variant_row.id,
      variant_row.product_id,
      variant_row.sku,
      variant_row.attributes,
      variant_row.condition,
      variant_row.price_override,
      variant_row.images,
      variant_row.primary_image,
      variant_row.created_at,
      variant_row.updated_at,
      CASE
        WHEN variant_row.inventory_tracking_policy IN (
          'off',
          'serialized_strict',
          'serialized_then_unlimited'
        ) THEN variant_row.inventory_tracking_policy
        WHEN product_row.inventory_tracking_policy IN (
          'serialized_strict',
          'serialized_then_unlimited'
        ) THEN product_row.inventory_tracking_policy
        ELSE 'off'::text
      END AS effective_policy,
      variant_row.stock_quantity AS stored_stock_quantity,
      COALESCE(availability.public_available_units, 0) AS available_units
    FROM selected_product AS product_row
    JOIN public.product_variants AS variant_row
      ON variant_row.product_id = product_row.id
      AND variant_row.merchant_id = product_row.merchant_id
      AND variant_row.is_inventory_anchor IS NOT TRUE
    LEFT JOIN availability_counts AS availability
      ON availability.product_id = variant_row.product_id
      AND availability.variant_id = variant_row.id
    -- The critical snapshot stays bounded, but always retains the configured
    -- default and then the lowest-priced choices. `variants_truncated` below
    -- tells the application to use the existing full variant RPC for rare
    -- catalogs whose selected option falls outside this critical subset.
    ORDER BY
      (variant_row.id = product_row.default_variant_id) DESC,
      COALESCE(variant_row.price_override, product_row.price),
      variant_row.created_at,
      variant_row.id
    LIMIT 128
  ),
  variant_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', variant.id,
          'product_id', variant.product_id,
          'sku', variant.sku,
          'attributes', variant.attributes,
          'condition', variant.condition,
          'price_override', variant.price_override,
          'stock_quantity',
            CASE variant.effective_policy
              WHEN 'serialized_strict' THEN variant.available_units
              WHEN 'serialized_then_unlimited' THEN
                CASE
                  WHEN variant.available_units > 0 THEN variant.available_units
                  ELSE 9999
                END
              ELSE variant.stored_stock_quantity
            END,
          'images', variant.images,
          'primary_image', variant.primary_image,
          'created_at', variant.created_at,
          'updated_at', variant.updated_at,
          'inventory_tracking_policy', variant.effective_policy
        )
        ORDER BY variant.created_at, variant.id
      ),
      '[]'::jsonb
    ) AS data
    FROM variant_source AS variant
  ),
  offer_source AS MATERIALIZED (
    SELECT
      offer_row.id,
      offer_row.condition,
      offer_row.price,
      offer_row.compare_at_price,
      offer_row.stock_quantity,
      offer_row.images,
      offer_row.condition_notes,
      offer_row.grade,
      offer_row.status
    FROM selected_product AS product_row
    JOIN public.product_offers AS offer_row
      ON offer_row.product_id = product_row.id
      AND offer_row.merchant_id = product_row.merchant_id
      AND offer_row.status = 'active'
    ORDER BY offer_row.condition, offer_row.id
    LIMIT 16
  ),
  offer_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', offer.id,
          'condition', offer.condition,
          'price', offer.price,
          'compare_at_price', offer.compare_at_price,
          'stock_quantity', offer.stock_quantity,
          'images', offer.images,
          'condition_notes', offer.condition_notes,
          'grade', offer.grade,
          'status', offer.status
        )
        ORDER BY offer.condition, offer.id
      ),
      '[]'::jsonb
    ) AS data
    FROM offer_source AS offer
  ),
  key_spec_json AS (
    SELECT
      product_row.id AS product_id,
      CASE
        WHEN key_spec.product_id IS NULL THEN NULL::jsonb
        ELSE
          jsonb_build_object(
            'created_at', key_spec.created_at,
            'screen_size_inches', key_spec.screen_size_inches,
            'refresh_rate_hz', key_spec.refresh_rate_hz,
            'chipset', key_spec.chipset,
            'ram_gb', key_spec.ram_gb,
            'storage_gb', key_spec.storage_gb,
            'main_camera_mp', key_spec.main_camera_mp,
            'battery_mah', key_spec.battery_mah,
            'charging_watt', key_spec.charging_watt,
            'has_5g', key_spec.has_5g,
            'android_version', key_spec.android_version,
            'network_technology', key_spec.network_technology,
            'sim_type', key_spec.sim_type,
            'has_nfc', key_spec.has_nfc,
            'wifi_bands', key_spec.wifi_bands,
            'bluetooth_version', key_spec.bluetooth_version,
            'usb_type', key_spec.usb_type,
            'has_usb_otg', key_spec.has_usb_otg,
            'positioning', key_spec.positioning,
            'has_fm_radio', key_spec.has_fm_radio,
            'dimensions_mm', key_spec.dimensions_mm,
            'weight_g', key_spec.weight_g,
            'build_materials', key_spec.build_materials,
            'ip_rating', key_spec.ip_rating,
            'display_type', key_spec.display_type,
            'display_resolution', key_spec.display_resolution,
            'display_ppi', key_spec.display_ppi,
            'display_protection', key_spec.display_protection,
            'display_peak_brightness', key_spec.display_peak_brightness
          )
          ||
          jsonb_build_object(
            'front_camera_mp', key_spec.front_camera_mp,
            'front_camera_features', key_spec.front_camera_features,
            'front_camera_video', key_spec.front_camera_video,
            'rear_camera_features', key_spec.rear_camera_features,
            'rear_camera_video', key_spec.rear_camera_video,
            'has_dual_camera', key_spec.has_dual_camera,
            'has_triple_camera', key_spec.has_triple_camera,
            'has_quad_camera', key_spec.has_quad_camera,
            'has_stereo_speakers', key_spec.has_stereo_speakers,
            'has_headphone_jack', key_spec.has_headphone_jack,
            'fingerprint_type', key_spec.fingerprint_type,
            'sensors', key_spec.sensors,
            'battery_removable', key_spec.battery_removable,
            'has_wireless_charging', key_spec.has_wireless_charging,
            'wireless_charging_watt', key_spec.wireless_charging_watt,
            'has_reverse_charging', key_spec.has_reverse_charging,
            'cpu_cores', key_spec.cpu_cores,
            'gpu', key_spec.gpu,
            'has_card_slot', key_spec.has_card_slot,
            'card_slot_type', key_spec.card_slot_type,
            'available_colors', key_spec.available_colors,
            'model_numbers', key_spec.model_numbers,
            'announced_date', key_spec.announced_date,
            'release_date', key_spec.release_date,
            'camera_score', key_spec.camera_score,
            'battery_score', key_spec.battery_score,
            'gaming_score', key_spec.gaming_score,
            'recommended_for', key_spec.recommended_for,
            'has_ois', key_spec.has_ois
          )
      END AS data
    FROM selected_product AS product_row
    LEFT JOIN public.product_key_specs AS key_spec
      ON key_spec.product_id = product_row.id
  )
  SELECT
    'found'::text AS resolution_status,
    (
      jsonb_build_object(
        'id', product_row.id,
        'merchant_id', product_row.merchant_id,
        'category_id', product_row.category_id,
        'created_at', product_row.created_at,
        'updated_at', product_row.updated_at,
        'name', product_row.name,
        'description', product_row.description,
        'status', product_row.status,
        'price', product_row.price,
        'compare_at_price', product_row.compare_at_price,
        'stock',
          CASE inventory.effective_policy
            WHEN 'serialized_strict' THEN inventory.available_units
            WHEN 'serialized_then_unlimited' THEN
              CASE
                WHEN inventory.available_units > 0 THEN inventory.available_units
                ELSE 9999
              END
            ELSE product_row.stock
          END,
        'stock_quantity',
          CASE inventory.effective_policy
            WHEN 'serialized_strict' THEN inventory.available_units
            WHEN 'serialized_then_unlimited' THEN
              CASE
                WHEN inventory.available_units > 0 THEN inventory.available_units
                ELSE 9999
              END
            ELSE product_row.stock_quantity
          END,
        'manage_stock',
          CASE inventory.effective_policy
            WHEN 'serialized_strict' THEN true
            WHEN 'serialized_then_unlimited' THEN false
            ELSE product_row.manage_stock
          END,
        'low_stock_threshold', product_row.low_stock_threshold,
        'sku', product_row.sku,
        'slug', product_row.slug,
        'condition', product_row.condition,
        'condition_detail', product_row.condition_detail,
        'variant_model', product_row.variant_model,
        'default_variant_id', product_row.default_variant_id,
        'available_conditions', product_row.available_conditions,
        'min_variant_price', product_row.min_variant_price,
        'max_variant_price', product_row.max_variant_price,
        'brand', product_row.brand,
        'category', product_row.category
      )
      ||
      jsonb_build_object(
        'color', product_row.color,
        'has_variants', product_row.has_variants,
        'has_condition_offers', product_row.has_condition_offers,
        'variant_attributes', product_row.variant_attributes,
        'images', product_row.images,
        'imageHint', product_row.image_hint,
        'specifications', product_row.specifications,
        'weight_value', product_row.weight_value,
        'weight_unit', product_row.weight_unit,
        'dimensions', product_row.dimensions,
        'taxable', product_row.taxable,
        'tax_code', product_row.tax_code,
        'meta_title', product_row.meta_title,
        'meta_description', product_row.meta_description,
        'keywords', product_row.keywords,
        'canonical_url', product_row.canonical_url,
        'schema_markup', product_row.schema_markup,
        'gtin', product_row.gtin,
        'mpn', product_row.mpn,
        'google_product_category', product_row.google_product_category,
        'fulfillmentFields', product_row.fulfillment_fields,
        'inventory_tracking_policy', product_row.inventory_tracking_policy,
        'effective_policy', inventory.effective_policy
      )
      ||
      jsonb_build_object(
        'categories',
          CASE
            WHEN canonical_category.id IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object(
              'id', canonical_category.id,
              'name', canonical_category.name,
              'slug', canonical_category.slug,
              'parent_id', canonical_category.parent_id
            )
          END,
        'product_key_specs', key_specs.data,
        'product_offers', offers.data,
        'product_variants', variants.data,
        'variant_count', variant_population.total_count,
        'variants_truncated',
          variant_population.total_count >
            pg_catalog.jsonb_array_length(variants.data)
      )
    ) AS product_data
  FROM selected_product AS product_row
  LEFT JOIN simple_inventory_state AS inventory
    ON inventory.product_id = product_row.id
  LEFT JOIN LATERAL (
    SELECT
      category_candidate.id,
      category_candidate.name,
      category_candidate.slug,
      category_candidate.parent_id
    FROM (
      SELECT
        direct_category.id,
        direct_category.name,
        direct_category.slug,
        direct_category.parent_id,
        0 AS category_rank
      FROM public.categories AS direct_category
      WHERE direct_category.id = product_row.category_id
        AND direct_category.is_active IS TRUE

      UNION ALL

      SELECT
        joined_category.id,
        joined_category.name,
        joined_category.slug,
        joined_category.parent_id,
        1 AS category_rank
      FROM public.product_categories AS membership
      JOIN public.categories AS joined_category
        ON joined_category.id = membership.category_id
        AND joined_category.is_active IS TRUE
      WHERE membership.product_id = product_row.id
    ) AS category_candidate
    ORDER BY category_candidate.category_rank, category_candidate.id
    LIMIT 1
  ) AS canonical_category ON true
  LEFT JOIN key_spec_json AS key_specs
    ON key_specs.product_id = product_row.id
  CROSS JOIN offer_json AS offers
  CROSS JOIN variant_json AS variants
  CROSS JOIN variant_population

  UNION ALL

  SELECT
    'redirect'::text,
    jsonb_build_object(
      'id', redirect_target.id,
      'name', redirect_target.name,
      'slug', redirect_target.slug,
      'status', redirect_target.status,
      'category', redirect_target.category,
      'categories',
        CASE
          WHEN redirect_target.category_id IS NULL THEN NULL::jsonb
          ELSE jsonb_build_object(
            'id', redirect_target.category_id,
            'name', redirect_target.category_name,
            'slug', redirect_target.category_slug,
            'parent_id', redirect_target.category_parent_id
          )
        END
    )
  FROM legacy_redirect_target AS redirect_target
  WHERE NOT EXISTS (SELECT 1 FROM selected_product)

  UNION ALL

  SELECT
    'not_found'::text,
    NULL::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM selected_product)
    AND NOT EXISTS (SELECT 1 FROM legacy_redirect_target);
$$;

REVOKE ALL ON FUNCTION private.get_storefront_pdp_core_v2(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_storefront_pdp_core_v2(uuid, text, uuid)
  TO service_role;
