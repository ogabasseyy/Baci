-- A selected assurance must have a server-priced rate, and checkout must use
-- the same assurance selection/rate that the shopper reviewed. Patch the
-- installed binder so its current authorization and checkout behavior remain
-- intact.
DO $$
DECLARE
  v_signature constant text :=
    'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)';
  v_definition text := pg_get_functiondef(v_signature::regprocedure);
  v_old_review text :=
    'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'',line->''validatedUnitPriceMinor'')';
  v_new_review text :=
    'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'',line->''validatedUnitPriceMinor'',line->''hasAssurance'',line->''assuranceRate'')';
  v_old_review_count integer;
  v_new_review_count integer;
  v_null_rate text := 'OR l.assurance_rate IS NULL';
  v_marker text := '-- Reviewed assurance rate is required before item derivation.';
  v_anchor text := E'  v_items := p_args -> ''p_items'';\n  IF jsonb_typeof(v_items) IS DISTINCT FROM ''array'' THEN';
  v_validation text := E'  IF EXISTS (\n'
    || '    SELECT 1 FROM jsonb_array_elements(coalesce(v_snapshot->''lines'', ''[]''::jsonb)) line' || E'\n'
    || '    WHERE coalesce((line->>''hasAssurance'')::boolean, false)' || E'\n'
    || '      AND (line->''assuranceRate'' IS NULL OR line->''assuranceRate'' = ''null''::jsonb)' || E'\n'
    || '  ) THEN' || E'\n'
    || '    RAISE EXCEPTION ''cart_checkout_stale'' USING ERRCODE = ''P0001'';' || E'\n'
    || '  END IF;';
  v_marker_count integer;
  v_validation_count integer;
  v_anchor_count integer;
BEGIN
  v_old_review_count := (length(v_definition) - length(replace(v_definition, v_old_review, ''))) / length(v_old_review);
  v_new_review_count := (length(v_definition) - length(replace(v_definition, v_new_review, ''))) / length(v_new_review);
  v_marker_count := (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker);
  v_validation_count := (length(v_definition) - length(replace(v_definition, v_validation, ''))) / length(v_validation);
  v_anchor_count := (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor);

  IF v_old_review_count = 0 AND v_new_review_count = 2
    AND v_marker_count = 1 AND v_validation_count = 1
    AND position(v_null_rate IN v_definition) = 0 THEN
    RETURN;
  END IF;
  IF v_old_review_count <> 2 OR v_new_review_count <> 0
    OR (length(v_definition) - length(replace(v_definition, v_null_rate, ''))) / length(v_null_rate) <> 1
    OR v_anchor_count <> 1 OR v_marker_count <> 0 OR v_validation_count <> 0 THEN
    RAISE EXCEPTION 'cart binding assurance comparison anchor changed';
  END IF;

  v_definition := replace(v_definition, v_old_review, v_new_review);
  v_definition := replace(v_definition, v_null_rate, '');
  v_definition := replace(v_definition, v_anchor, v_marker || E'\n' || v_validation || E'\n' || v_anchor);
  EXECUTE v_definition;
END $$;
