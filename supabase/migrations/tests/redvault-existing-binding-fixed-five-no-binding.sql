DO $$
DECLARE
  fixture redvault_fixed_five_fixture%ROWTYPE;
  converted jsonb;
  unrelated jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_fixed_five_fixture;
  SELECT to_jsonb(code.*) INTO STRICT converted
  FROM public.discount_codes AS code WHERE code.id = fixture.bound_code_id;
  SELECT to_jsonb(code.*) INTO STRICT unrelated
  FROM public.discount_codes AS code WHERE code.id = fixture.unrelated_code_id;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_discount_binding
    WHERE discount_code_id = fixture.bound_code_id
  ) OR (converted - 'updated_at') IS DISTINCT FROM jsonb_set(
      (SELECT original_row - 'updated_at' FROM redvault_fixed_five_expected_codes WHERE id = fixture.bound_code_id),
      '{discount_value}', '5'::jsonb
    ) OR unrelated IS DISTINCT FROM (
      SELECT original_row FROM redvault_fixed_five_expected_codes WHERE id = fixture.unrelated_code_id
    ) THEN
    RAISE EXCEPTION 'redvault_no_binding_migration_changed_fixture';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.discount_codes'::regclass
      AND tgname = 'prevent_uba_redvault_discount_mutation'
      AND tgenabled = 'O' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'redvault_discount_immutability_guard_not_restored'; END IF;
  PERFORM pg_temp.assert_redvault_fixed_five_history_unchanged();
  INSERT INTO private.uba_redvault_discount_binding(discount_code_id, merchant_id, partnership)
  VALUES (fixture.bound_code_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'uba_redvault');
END;
$$;
