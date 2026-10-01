-- Break product ties by variant in every order-item claim loop so concurrent
-- checkouts, confirmations, and releases acquire locks for one product in a
-- common product-and-variant order. Item ids alone leave multi-variant
-- orders of the same product in insertion order, which can invert across
-- transactions and deadlock through the stock-sync trigger.
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
    AND function_definition.proname = 'create_storefront_order_unchecked'
    AND function_definition.pronargs = 24;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_unchecked_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY oi.product_id, oi.variant_id, oi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY oi.product_id, oi.id',
      'ORDER BY oi.product_id, oi.variant_id, oi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'storefront_order_claim_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;

  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'prepare_storefront_order_for_checkout'
    AND function_definition.pronargs = 9;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_reuse_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY oi.product_id, oi.variant_id, oi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY oi.product_id, oi.id',
      'ORDER BY oi.product_id, oi.variant_id, oi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'storefront_order_reuse_claim_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;

  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'confirm_order_inventory_reservations'
    AND function_definition.pronargs = 2;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'confirmation_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY oi.product_id, oi.variant_id, oi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY oi.product_id, oi.id',
      'ORDER BY oi.product_id, oi.variant_id, oi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'confirmation_claim_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;

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
    'ORDER BY oi.product_id, oi.variant_id, oi.id'
  ) = 0 THEN
    v_updated := pg_catalog.replace(
      v_definition,
      'ORDER BY oi.product_id, oi.id',
      'ORDER BY oi.product_id, oi.variant_id, oi.id'
    );
    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'release_claim_variant_patch_failed';
    END IF;

    EXECUTE v_updated;
  END IF;
END;
$migration$;
