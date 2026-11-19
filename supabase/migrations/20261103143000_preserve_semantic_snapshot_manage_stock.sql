-- Preserve manage_stock through private.get_storefront_pdp_semantic_enrichment_v1
-- so storefront PDP semantic candidate models accurately differentiate unmanaged
-- stock (null) from tracked/finite stock (0 = out of stock).

CREATE OR REPLACE FUNCTION private.get_storefront_pdp_semantic_enrichment_v1(
  p_merchant_id uuid,
  p_product_id uuid,
  p_category_slug text,
  p_cluster_rules jsonb,
  p_search_query text,
  p_include_guides boolean DEFAULT true,
  p_inventory_limit integer DEFAULT 48,
  p_cluster_guide_limit integer DEFAULT 48,
  p_product_guide_limit integer DEFAULT 8
)
RETURNS TABLE (
  resolution_status text,
  inventory_data jsonb,
  cluster_guide_data jsonb,
  product_guide_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
ROWS 1
AS $$
  WITH raw_input AS MATERIALIZED (
    SELECT
      COALESCE(p_category_slug, '') AS category_slug,
      COALESCE(p_include_guides, false) AS include_guides,
      LEAST(
        GREATEST(COALESCE(p_inventory_limit, 48), 1),
        48
      ) AS inventory_limit,
      LEAST(
        GREATEST(COALESCE(p_cluster_guide_limit, 48), 1),
        48
      ) AS cluster_guide_limit,
      LEAST(
        GREATEST(COALESCE(p_product_guide_limit, 8), 1),
        8
      ) AS product_guide_limit
  ),
  validated_input AS MATERIALIZED (
    SELECT
      raw_input.*,
      p_merchant_id IS NOT NULL
        AND p_product_id IS NOT NULL
        AND pg_catalog.btrim(raw_input.category_slug) <> ''
        AND pg_catalog.octet_length(raw_input.category_slug) <= 64 AS valid
    FROM raw_input
  ),
  input AS MATERIALIZED (
    SELECT
      CASE
        WHEN validated_input.valid THEN pg_catalog.lower(
          pg_catalog.btrim(validated_input.category_slug)
        )
        ELSE ''::text
      END AS category_slug,
      CASE
        WHEN validated_input.valid THEN pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.lower(validated_input.category_slug),
              '[-_]+',
              ' ',
              'g'
            ),
            '[^[:alnum:] ]+',
            '',
            'g'
          )
        )
        ELSE ''::text
      END AS legacy_category_name,
      validated_input.include_guides,
      validated_input.inventory_limit,
      validated_input.cluster_guide_limit,
      validated_input.product_guide_limit,
      validated_input.valid
    FROM validated_input
  ),
  current_product AS MATERIALIZED (
    SELECT
      product_row.id,
      product_row.merchant_id,
      product_row.category_id,
      product_row.created_at,
      product_row.slug,
      product_row.name,
      product_row.brand,
      product_row.condition,
      product_row.price,
      product_row.stock,
      product_row.stock_quantity,
      product_row.manage_stock,
      product_row.category
    FROM input
    JOIN public.products AS product_row
      ON input.valid
      AND product_row.id = p_product_id
      AND product_row.merchant_id = p_merchant_id
      AND product_row.status = 'active'
    JOIN public.merchants AS merchant_row
      ON merchant_row.id = product_row.merchant_id
      AND (
        COALESCE(merchant_row.is_published, false) = true
        OR COALESCE(merchant_row.is_platform_admin, false) = true
      )
    LIMIT 1
  ),
  category_state AS MATERIALIZED (
    SELECT
      category_row.id,
      category_row.is_active
    FROM input
    JOIN public.categories AS category_row
      ON category_row.merchant_id = p_merchant_id
      AND category_row.slug = input.category_slug
    ORDER BY category_row.id
    LIMIT 1
  ),
  category_scope AS MATERIALIZED (
    SELECT category_row.id
    FROM category_state AS requested_category
    JOIN public.categories AS category_row
      ON category_row.merchant_id = p_merchant_id
      AND category_row.is_active IS TRUE
      AND (
        category_row.id = requested_category.id
        OR category_row.parent_id = requested_category.id
      )
    WHERE requested_category.is_active IS TRUE
  ),
  scoped_products AS MATERIALIZED (
    SELECT
      product_row.id,
      product_row.merchant_id,
      product_row.category_id,
      product_row.created_at,
      product_row.slug,
      product_row.name,
      product_row.brand,
      product_row.condition,
      product_row.price,
      product_row.stock,
      product_row.stock_quantity,
      product_row.manage_stock,
      product_row.category
    FROM input
    CROSS JOIN current_product
    JOIN public.products AS product_row
      ON product_row.merchant_id = p_merchant_id
      AND product_row.status = 'active'
      AND product_row.id <> p_product_id
    WHERE (
      (
        EXISTS (
          SELECT 1
          FROM category_state
          WHERE category_state.is_active IS TRUE
        )
        AND (
          product_row.category_id IN (SELECT category_scope.id FROM category_scope)
          OR EXISTS (
            SELECT 1
            FROM public.product_categories AS membership
            WHERE membership.product_id = product_row.id
              AND membership.category_id IN (
                SELECT category_scope.id FROM category_scope
              )
          )
        )
      )
      OR (
        NOT EXISTS (SELECT 1 FROM category_state)
        AND input.legacy_category_name <> ''
        AND (
          COALESCE(product_row.category, '') OPERATOR(pg_catalog.~~*)
            ('%' || input.legacy_category_name || '%')
          OR COALESCE(product_row.brand, '') OPERATOR(pg_catalog.~~*)
            ('%' || input.legacy_category_name || '%')
          OR product_row.name OPERATOR(pg_catalog.~~*)
            ('%' || input.legacy_category_name || '%')
        )
      )
    )
    ORDER BY product_row.created_at DESC, product_row.id
    LIMIT (SELECT input.inventory_limit FROM input)
  ),
  candidate_products AS MATERIALIZED (
    SELECT
      current_product.id,
      current_product.merchant_id,
      current_product.category_id,
      current_product.created_at,
      current_product.slug,
      current_product.name,
      current_product.brand,
      current_product.condition,
      current_product.price,
      current_product.stock,
      current_product.stock_quantity,
      current_product.manage_stock,
      current_product.category,
      true AS is_current
    FROM current_product

    UNION ALL

    SELECT
      scoped_products.id,
      scoped_products.merchant_id,
      scoped_products.category_id,
      scoped_products.created_at,
      scoped_products.slug,
      scoped_products.name,
      scoped_products.brand,
      scoped_products.condition,
      scoped_products.price,
      scoped_products.stock,
      scoped_products.stock_quantity,
      scoped_products.manage_stock,
      scoped_products.category,
      false AS is_current
    FROM scoped_products
  ),
  inventory_rows AS MATERIALIZED (
    SELECT
      candidate.id,
      candidate.created_at,
      candidate.is_current,
      jsonb_build_object(
        'id', candidate.id,
        'slug', candidate.slug,
        'name', candidate.name,
        'brand', candidate.brand,
        'condition', candidate.condition,
        'price', candidate.price,
        'stock', candidate.stock,
        'stock_quantity', candidate.stock_quantity,
        'manage_stock', candidate.manage_stock,
        'category', candidate.category,
        'category_id', candidate.category_id,
        'categories',
          CASE
            WHEN canonical_category.slug IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object('slug', canonical_category.slug)
          END,
        'product_key_specs',
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
          END
      ) AS data
    FROM candidate_products AS candidate
    LEFT JOIN LATERAL (
      SELECT category_candidate.slug
      FROM (
        SELECT
          direct_category.slug,
          0 AS category_rank,
          direct_category.id
        FROM public.categories AS direct_category
        WHERE direct_category.id = candidate.category_id
          AND direct_category.is_active IS TRUE

        UNION ALL

        SELECT
          joined_category.slug,
          CASE WHEN membership.is_primary IS TRUE THEN 1 ELSE 2 END,
          joined_category.id
        FROM public.product_categories AS membership
        JOIN public.categories AS joined_category
          ON joined_category.id = membership.category_id
          AND joined_category.is_active IS TRUE
        WHERE membership.product_id = candidate.id
      ) AS category_candidate
      ORDER BY category_candidate.category_rank, category_candidate.id
      LIMIT 1
    ) AS canonical_category ON true
    LEFT JOIN public.product_key_specs AS key_spec
      ON key_spec.product_id = candidate.id
  ),
  inventory_json AS (
    SELECT COALESCE(
      jsonb_agg(
        inventory_rows.data
        ORDER BY
          inventory_rows.is_current DESC,
          inventory_rows.created_at DESC,
          inventory_rows.id
      ),
      '[]'::jsonb
    ) AS data
    FROM inventory_rows
  ),
  blog_enabled AS MATERIALIZED (
    SELECT EXISTS (
      SELECT 1
      FROM public.merchant_feature_settings AS settings
      WHERE settings.merchant_id = p_merchant_id
        AND settings.blog_enabled IS TRUE
    ) AS enabled
  ),
  cluster_guide_source AS MATERIALIZED (
    SELECT
      guide.slug,
      guide.title,
      guide.excerpt,
      guide.category,
      guide.tags,
      guide.keywords,
      guide.featured_image_url,
      guide.published_at,
      guide.reading_time_minutes,
      guide.guide_order
    FROM input
    CROSS JOIN current_product
    CROSS JOIN blog_enabled
    CROSS JOIN LATERAL public.get_storefront_cluster_guide_candidates_v1(
      p_merchant_id,
      input.category_slug,
      p_cluster_rules,
      p_search_query,
      input.cluster_guide_limit
    ) WITH ORDINALITY AS guide(
      slug,
      title,
      excerpt,
      category,
      tags,
      keywords,
      featured_image_url,
      published_at,
      reading_time_minutes,
      guide_order
    )
    WHERE input.include_guides
      AND blog_enabled.enabled
  ),
  cluster_guide_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'slug', guide.slug,
          'title', guide.title,
          'excerpt', guide.excerpt,
          'category', guide.category,
          'tags', guide.tags,
          'keywords', guide.keywords,
          'featured_image_url', guide.featured_image_url,
          'published_at', guide.published_at,
          'reading_time_minutes', guide.reading_time_minutes
        )
        ORDER BY guide.guide_order
      ),
      '[]'::jsonb
    ) AS data
    FROM cluster_guide_source AS guide
  ),
  product_guide_source AS MATERIALIZED (
    SELECT
      post.slug,
      post.title,
      post.excerpt,
      post.category,
      post.tags,
      post.keywords,
      post.featured_image_url,
      post.published_at,
      post.reading_time_minutes,
      link.created_at AS linked_at
    FROM input
    CROSS JOIN current_product
    CROSS JOIN blog_enabled
    JOIN public.blog_post_products AS link
      ON link.merchant_id = p_merchant_id
      AND link.product_id = p_product_id
    JOIN public.blog_posts AS post
      ON post.id = link.blog_post_id
      AND post.merchant_id = p_merchant_id
      AND post.status = 'published'
      AND post.published_at IS NOT NULL
      AND pg_catalog.btrim(post.slug) <> ''
      AND pg_catalog.btrim(post.title) <> ''
    WHERE input.include_guides
      AND blog_enabled.enabled
    ORDER BY link.created_at DESC, post.published_at DESC, post.slug
    LIMIT (SELECT input.product_guide_limit FROM input)
  ),
  product_guide_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'slug', guide.slug,
          'title', guide.title,
          'excerpt', guide.excerpt,
          'category', guide.category,
          'tags', guide.tags,
          'keywords', guide.keywords,
          'featured_image_url', guide.featured_image_url,
          'published_at', guide.published_at,
          'reading_time_minutes', guide.reading_time_minutes
        )
        ORDER BY guide.linked_at DESC, guide.published_at DESC, guide.slug
      ),
      '[]'::jsonb
    ) AS data
    FROM product_guide_source AS guide
  )
  SELECT
    'found'::text,
    inventory_json.data,
    cluster_guide_json.data,
    product_guide_json.data
  FROM input
  CROSS JOIN inventory_json
  CROSS JOIN cluster_guide_json
  CROSS JOIN product_guide_json
  WHERE EXISTS (SELECT 1 FROM current_product)

  UNION ALL

  SELECT
    'not_found'::text,
    NULL::jsonb,
    NULL::jsonb,
    NULL::jsonb
  FROM input
  WHERE NOT EXISTS (SELECT 1 FROM current_product);
$$;

CREATE OR REPLACE FUNCTION public.get_storefront_pdp_semantic_enrichment_v1(
  p_merchant_id uuid,
  p_product_id uuid,
  p_category_slug text,
  p_cluster_rules jsonb,
  p_search_query text,
  p_include_guides boolean DEFAULT true,
  p_inventory_limit integer DEFAULT 48,
  p_cluster_guide_limit integer DEFAULT 48,
  p_product_guide_limit integer DEFAULT 8
)
RETURNS TABLE (
  resolution_status text,
  inventory_data jsonb,
  cluster_guide_data jsonb,
  product_guide_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
ROWS 1
AS $$
  SELECT
    enrichment.resolution_status,
    enrichment.inventory_data,
    enrichment.cluster_guide_data,
    enrichment.product_guide_data
  FROM private.get_storefront_pdp_semantic_enrichment_v1(
    p_merchant_id,
    p_product_id,
    p_category_slug,
    p_cluster_rules,
    p_search_query,
    p_include_guides,
    p_inventory_limit,
    p_cluster_guide_limit,
    p_product_guide_limit
  ) AS enrichment;
$$;

REVOKE ALL ON FUNCTION private.get_storefront_pdp_semantic_enrichment_v1(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  integer,
  integer,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_storefront_pdp_semantic_enrichment_v1(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  integer,
  integer,
  integer
) TO service_role;

REVOKE ALL ON FUNCTION public.get_storefront_pdp_semantic_enrichment_v1(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  integer,
  integer,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_pdp_semantic_enrichment_v1(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  integer,
  integer,
  integer
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_storefront_pdp_semantic_enrichment_v1(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  integer,
  integer,
  integer
) IS
  'One-call optional PDP semantic inventory and guide snapshot with current-product inclusion, canonical category slugs, explicit found/not_found status, manage_stock inventory projection, and hard result limits.';
