-- Variant, inventory, and key-spec fixtures for public PDP snapshot assertions.

DO $setup$
BEGIN
  INSERT INTO public.products (
    id,
    merchant_id,
    category_id,
    parent_product_id,
    name,
    slug,
    price,
    status,
    has_variants,
    manage_stock,
    stock,
    stock_quantity,
    inventory_tracking_policy,
    images
  ) VALUES
    (
      '4d19ab10-0000-4000-8000-000000000007'::uuid,
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000002'::uuid,
      '4d19ab10-0000-4000-8000-000000000005'::uuid,
      'Legacy Variant Snapshot Phone',
      'legacy-variant-snapshot-phone',
      200000,
      'archived',
      false,
      false,
      0,
      0,
      'off',
      '[]'::jsonb
    ),
    (
      '4d19ab10-0000-4000-8000-000000000016'::uuid,
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000002'::uuid,
      '4d19ab10-0000-4000-8000-000000000015'::uuid,
      'Legacy Blank Slug Snapshot Phone',
      'legacy-blank-slug-snapshot-phone',
      225000,
      'archived',
      false,
      false,
      0,
      0,
      'off',
      '[]'::jsonb
    ),
    (
      '4d19ab10-0000-4000-8000-000000000021'::uuid,
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000002'::uuid,
      NULL,
      'Null Manage Stock Snapshot Phone',
      'null-manage-stock-snapshot-phone',
      190000,
      'active',
      false,
      NULL,
      0,
      0,
      'off',
      '[]'::jsonb
    );

  INSERT INTO public.product_variants (
    id,
    merchant_id,
    product_id,
    sku,
    attributes,
    stock_quantity,
    is_inventory_anchor,
    inventory_tracking_policy
  ) VALUES
    (
      '4d19ab10-0000-4000-8000-000000000004'::uuid,
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000003'::uuid,
      'SNAPSHOT-SIMPLE-ANCHOR',
      '{}'::jsonb,
      99,
      true,
      'inherit'
    ),
    (
      '4d19ab10-0000-4000-8000-000000000006'::uuid,
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000005'::uuid,
      'SNAPSHOT-VARIANT-128-BLACK',
      '{"storage":"128GB","color":"Black"}'::jsonb,
      99,
      false,
      'inherit'
    );

  INSERT INTO public.product_variants (
    id,
    merchant_id,
    product_id,
    sku,
    attributes,
    price_override,
    stock_quantity,
    is_inventory_anchor,
    inventory_tracking_policy,
    created_at
  )
  SELECT
    (
      '4d19ab10-0000-4001-8000-'
      || pg_catalog.lpad(series.variant_number::text, 12, '0')
    )::uuid,
    '4d19ab10-0000-4000-8000-000000000001'::uuid,
    '4d19ab10-0000-4000-8000-000000000017'::uuid,
    'SNAPSHOT-LARGE-' || series.variant_number::text,
    pg_catalog.jsonb_build_object('storage', series.variant_number::text || 'GB'),
    250000 + series.variant_number,
    1,
    false,
    'inherit',
    pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs => series.variant_number)
  FROM pg_catalog.generate_series(1, 130) AS series(variant_number);

  UPDATE public.products
  SET default_variant_id = '4d19ab10-0000-4001-8000-000000000130'::uuid
  WHERE id = '4d19ab10-0000-4000-8000-000000000017'::uuid;

  INSERT INTO public.variant_inventory (
    merchant_id,
    variant_id,
    identifier_type,
    identifier_value,
    status
  ) VALUES
    (
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000004'::uuid,
      'imei',
      '352313505010646',
      'available'
    ),
    (
      '4d19ab10-0000-4000-8000-000000000001'::uuid,
      '4d19ab10-0000-4000-8000-000000000006'::uuid,
      'imei',
      '490154203237518',
      'available'
    );

  INSERT INTO public.product_key_specs (
    product_id,
    chipset,
    ram_gb,
    storage_gb
  ) VALUES
    ('4d19ab10-0000-4000-8000-000000000003'::uuid, 'Snapshot One', 8, 128),
    ('4d19ab10-0000-4000-8000-000000000008'::uuid, 'Snapshot Two', 12, 256);
END;
$setup$;
