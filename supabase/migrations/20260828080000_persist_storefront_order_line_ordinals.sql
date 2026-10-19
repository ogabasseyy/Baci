-- Preserve the request ordinal through the private storefront-order RPC. The
-- transaction-discount metadata uses that ordinal to disambiguate identical
-- product lines, while the legacy trigger's global sequence is only a
-- fallback for callers that do not provide one.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname IN (
      'create_storefront_order',
      'create_storefront_order_unchecked'
    )
    AND function_definition.pronargs = 24
  ORDER BY CASE function_definition.proname
    WHEN 'create_storefront_order_unchecked' THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(pg_catalog.lower(v_definition), 'line_ordinal') > 0 THEN
    RETURN;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    $$    variant_stock INTEGER
  ) ON COMMIT DROP;$$,
    $$    variant_stock INTEGER,
    line_ordinal INTEGER
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_temp_table_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$    variant_stock
  )
  SELECT$$,
    $$    variant_stock,
    line_ordinal
  )
  SELECT$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_temp_insert_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$    v.stock_quantity
  FROM ($$,
    $$    v.stock_quantity,
    r.line_ordinal
  FROM ($$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_outer_select_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$      GREATEST(COALESCE((item->>'assurance_fee')::numeric, 0), 0) AS assurance_fee
    FROM jsonb_array_elements(p_items) AS item$$,
    $$      GREATEST(COALESCE((item->>'assurance_fee')::numeric, 0), 0) AS assurance_fee,
      CASE
        WHEN item->>'__baci_line_ordinal' !~ '^[0-9]+$' THEN NULL
        WHEN length(item->>'__baci_line_ordinal') > 10 THEN NULL
        WHEN (item->>'__baci_line_ordinal')::numeric < 1
          OR (item->>'__baci_line_ordinal')::numeric > 2147483647 THEN NULL
        ELSE (item->>'__baci_line_ordinal')::int
      END AS line_ordinal
    FROM jsonb_array_elements(p_items) AS item$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_item_input_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$INSERT INTO public.order_items (
    order_id,
    product_id,$$,
    $$INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_item_line_id_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$  SELECT
    v_order_id,
    t.product_id,$$,
    $$  SELECT
    v_order_id,
    t.line_ordinal,
    t.product_id,$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_item_line_ordinal_select_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$    COALESCE(t.variant_attributes, '{}'::jsonb)
  FROM tmp_storefront_order_items t;$$,
    $$    COALESCE(t.variant_attributes, '{}'::jsonb)
  FROM tmp_storefront_order_items t
  ORDER BY t.line_ordinal NULLS LAST;$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_item_order_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $$  SELECT
    COUNT(*) FILTER (WHERE t.product_id IS NULL OR t.product_name IS NULL) AS invalid_item_count,
    COUNT(*) FILTER (WHERE t.quantity IS NULL OR t.quantity <= 0) AS invalid_quantity_count,
    COUNT(*) FILTER (
      WHERE t.variant_id IS NOT NULL AND t.variant_stock IS NULL
    ) AS invalid_variant_count
  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count
  FROM tmp_storefront_order_items t;

  IF v_invalid_item_count > 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  IF v_invalid_quantity_count > 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;$$,
    $$  SELECT
    COUNT(*) FILTER (WHERE t.product_id IS NULL OR t.product_name IS NULL) AS invalid_item_count,
    COUNT(*) FILTER (WHERE t.quantity IS NULL OR t.quantity <= 0) AS invalid_quantity_count,
    COUNT(*) FILTER (
      WHERE t.variant_id IS NOT NULL AND t.variant_stock IS NULL
    ) AS invalid_variant_count
  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count
  FROM tmp_storefront_order_items t;

  IF EXISTS (
    SELECT 1
    FROM tmp_storefront_order_items
    WHERE line_ordinal IS NOT NULL
    GROUP BY line_ordinal
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_line_ordinal';
  END IF;

  IF v_invalid_item_count > 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  IF v_invalid_quantity_count > 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;$$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'storefront_order_item_ordinal_validation_patch_failed';
  END IF;
  v_definition := v_updated;

  EXECUTE v_updated;
END;
$migration$;
