-- Break product ties by variant in the reserved-unit cursors so release and
-- sale transitions lock units of one product in the same product-and-variant
-- order that checkout and confirmation use for items. Unit UUID order can
-- run opposite variant order, which lets a cancellation hold one variant's
-- unit while checkout holds another's and contends through the stock-sync
-- trigger.
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
    AND function_definition.proname = 'release_order_inventory_units'
    AND function_definition.pronargs = 3;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'release_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY pv.product_id, vi.variant_id, vi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY pv.product_id, vi.id',
      'ORDER BY pv.product_id, vi.variant_id, vi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'release_unit_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;

  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'mark_order_inventory_units_sold'
    AND function_definition.pronargs = 2;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'sold_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY pv.product_id, vi.variant_id, vi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY pv.product_id, vi.id',
      'ORDER BY pv.product_id, vi.variant_id, vi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'sold_unit_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;
END;
$migration$;
