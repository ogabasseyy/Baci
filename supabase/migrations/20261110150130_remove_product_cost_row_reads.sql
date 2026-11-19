-- Keep invoker routines operational after products.cost_price SELECT is revoked.
-- Whole-row reads require every column even when the expression later discards
-- cost. Narrow only those reads; preserve rights, ACLs and all intervening fixes.
BEGIN;
DO $repair$
DECLARE
  patch record;
  definition text;
  occurrences integer;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.rebuild_sku_matrix_product_projection(uuid)',
     E'SELECT *\n  INTO v_product\n  FROM public.products',
     E'SELECT variant_model, condition, price, manage_stock, stock_quantity\n  INTO v_product.variant_model, v_product.condition, v_product.price,\n    v_product.manage_stock, v_product.stock_quantity\n  FROM public.products'),
    ('public.commerce_cart_product_negotiable(uuid,uuid)',
     'pg_catalog.to_jsonb(p) ->> ''brand'', pg_catalog.to_jsonb(p) ->> ''name''',
     'p.brand, p.name'),
    ('public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid)',
     'to_jsonb(product)->>''inventory_tracking_policy''',
     'product.inventory_tracking_policy'),
    ('public.commerce_cart_condition_pool_is_quantity_managed(uuid,uuid)',
     'nullif(to_jsonb(product)->>''inventory_anchor_variant_id'','''')::uuid',
     'product.inventory_anchor_variant_id'),
    ('public.commerce_cart_condition_supported(uuid,uuid,uuid,text)',
     'to_jsonb(p)->>''condition''',
     'p.condition'),
    ('public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
     'to_jsonb(p)->>''inventory_tracking_policy''',
     'p.inventory_tracking_policy')
  ) AS patches(signature, old_expression, new_expression)
  LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid=patch.signature::regprocedure) THEN
      RAISE EXCEPTION 'Expected SECURITY INVOKER routine: %', patch.signature;
    END IF;
    definition := pg_get_functiondef(patch.signature::regprocedure);
    occurrences := (length(definition)-length(replace(definition,patch.old_expression,'')))
      / length(patch.old_expression);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one product-row read in %, found %',
        patch.signature, occurrences;
    END IF;
    EXECUTE replace(definition,patch.old_expression,patch.new_expression);
  END LOOP;
END;
$repair$;
COMMIT;
