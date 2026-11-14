-- Bind the catalog/condition/variant price used for the review as well as
-- the effective checkout price. Negotiations and complete vouchers can keep
-- the effective amount constant while the validated offer changes.
-- Patch the installed function in place so its exact current authorization,
-- tenant checks, and idempotence behavior remain intact.
DO $$
DECLARE
  v_signature constant text :=
    'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)';
  v_definition text := pg_get_functiondef(v_signature::regprocedure);
  v_old text :=
    'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'')';
  v_new text :=
    'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'',line->''validatedUnitPriceMinor'')';
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  v_new_count := (length(v_definition) - length(replace(v_definition, v_new, ''))) / length(v_new);

  IF v_old_count = 0 AND v_new_count = 2 THEN
    RETURN;
  END IF;
  IF v_old_count <> 2 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'cart binding price comparison anchor count changed';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END $$;
