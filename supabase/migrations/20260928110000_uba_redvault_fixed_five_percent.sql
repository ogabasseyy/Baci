DO $migration$
DECLARE
  function_name text;
  definition text;
  old_rate text := 'v_rate := CASE WHEN (p_quote->>''eligibleSubtotalKobo'')::bigint < 20000000 THEN 10 ELSE 5 END;';
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'private.validate_redvault_discount_binding()',
    'public.create_storefront_redvault_order_draft(jsonb,jsonb)'
  ] LOOP
    definition := pg_catalog.pg_get_functiondef(function_name::regprocedure);
    IF pg_catalog.strpos(definition, 'discount_value IN (5, 10)') > 0 THEN
      definition := pg_catalog.replace(definition, 'discount_value IN (5, 10)', 'discount_value = 5');
    ELSIF pg_catalog.strpos(definition, 'discount_value = 5') = 0 THEN
      RAISE EXCEPTION 'redvault_fixed_five_binding_definition_changed: %', function_name;
    END IF;
    IF function_name = 'public.create_storefront_redvault_order_draft(jsonb,jsonb)' THEN
      IF pg_catalog.strpos(definition, '''mou_tiered_v1''') > 0 THEN
        definition := pg_catalog.replace(definition, '''mou_tiered_v1''', '''fixed5_v1''');
      ELSIF pg_catalog.strpos(definition, '''fixed5_v1''') = 0 THEN
        RAISE EXCEPTION 'redvault_fixed_five_policy_definition_changed';
      END IF;
    END IF;
    EXECUTE definition;
  END LOOP;
  definition := pg_catalog.pg_get_functiondef('private.validate_redvault_snapshot(uuid,jsonb)'::regprocedure);
  IF pg_catalog.strpos(definition, old_rate) > 0 THEN
    definition := pg_catalog.replace(definition, old_rate, 'v_rate := 5;');
  ELSIF pg_catalog.strpos(definition, 'v_rate := 5;') = 0 THEN
    RAISE EXCEPTION 'redvault_fixed_five_snapshot_definition_changed';
  END IF;
  EXECUTE definition;
END;
$migration$;
