-- The storefront route persists each request item ordinal as line_id. Use it
-- when attaching the voucher award so duplicate product lines cannot cause the
-- voucher marker to land on the first matching ordinary item.
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
    AND function_definition.proname = 'create_storefront_order_with_quiz_voucher'
    AND function_definition.pronargs = 23
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'quiz_voucher_order_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    pg_catalog.lower(v_definition),
    'v_voucher_line_ordinal'
  ) > 0 THEN
    RETURN;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    $patch$  v_voucher_item_count integer;
  v_reserved_order_id uuid;$patch$,
    $patch$  v_voucher_item_count integer;
  v_voucher_line_ordinal integer;
  v_reserved_order_id uuid;$patch$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'quiz_voucher_line_ordinal_declaration_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $patch$  v_condition := NULLIF(pg_catalog.btrim(COALESCE(v_voucher_item->>'condition', '')), '');$patch$,
    $patch$  v_condition := NULLIF(pg_catalog.btrim(COALESCE(v_voucher_item->>'condition', '')), '');

  IF NULLIF(pg_catalog.btrim(v_voucher_item->>'__baci_line_ordinal'), '') IS NOT NULL THEN
    IF v_voucher_item->>'__baci_line_ordinal' !~ '^[0-9]+$'
       OR pg_catalog.length(v_voucher_item->>'__baci_line_ordinal') > 10
       OR (v_voucher_item->>'__baci_line_ordinal')::numeric < 1
       OR (v_voucher_item->>'__baci_line_ordinal')::numeric > 2147483647 THEN
      RAISE EXCEPTION 'quiz_voucher_invalid';
    END IF;
    v_voucher_line_ordinal := (v_voucher_item->>'__baci_line_ordinal')::integer;
  END IF;$patch$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'quiz_voucher_line_ordinal_parse_patch_failed';
  END IF;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $patch$      AND (v_condition IS NULL OR oi.condition IS NOT DISTINCT FROM v_condition)
      AND oi.quiz_award_id IS NULL$patch$,
    $patch$      AND (v_condition IS NULL OR oi.condition IS NOT DISTINCT FROM v_condition)
      AND oi.quiz_award_id IS NULL
      AND (v_voucher_line_ordinal IS NULL OR oi.line_id = v_voucher_line_ordinal)$patch$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'quiz_voucher_line_ordinal_select_patch_failed';
  END IF;

  EXECUTE v_updated;
END;
$migration$;
