-- The unit editor and order confirmation lock product before inventory. The
-- deletion path must take that same order before locking joined variant rows.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('private.delete_variant_inventory_unit(uuid,uuid)'::regprocedure);
  anchor text := $old$  -- 2. Lock unit and verify ownership
  SELECT vi.*, pv.product_id$old$;
  replacement text := $new$  -- Resolve first, lock the product, then recheck the unit binding.
  SELECT pv.product_id INTO v_product_id
  FROM public.variant_inventory vi JOIN public.product_variants pv ON pv.id = vi.variant_id
  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.products p WHERE p.id = v_product_id AND p.merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002'; END IF;

  -- 2. Lock unit and verify ownership
  SELECT vi.*, pv.product_id$new$;
  unit_anchor text := $old$  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id
  FOR UPDATE;$old$;
  unit_replacement text := $new$  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id
    AND pv.product_id = v_product_id
  FOR UPDATE;$new$;
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1
    OR (length(definition) - length(replace(definition, unit_anchor, ''))) / length(unit_anchor) <> 1 THEN
    RAISE EXCEPTION 'serialized unit deletion lock source mismatch';
  END IF;
  definition := replace(definition, anchor, replacement);
  EXECUTE replace(definition, unit_anchor, unit_replacement);
END $patch$;
