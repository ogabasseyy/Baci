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
  IF (converted - 'updated_at') IS DISTINCT FROM jsonb_set(
      (SELECT original_row - 'updated_at' FROM redvault_fixed_five_expected_codes WHERE id = fixture.bound_code_id),
      '{discount_value}', '5'::jsonb
    ) OR unrelated IS DISTINCT FROM (
      SELECT original_row FROM redvault_fixed_five_expected_codes WHERE id = fixture.unrelated_code_id
    ) OR NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_discount_binding
      WHERE discount_code_id = fixture.bound_code_id
    ) THEN
    RAISE EXCEPTION 'redvault_existing_bound_five_replay_changed_fixture';
  END IF;
  PERFORM pg_temp.assert_redvault_fixed_five_history_unchanged();
  ALTER TABLE private.uba_redvault_discount_binding
    DISABLE TRIGGER validate_redvault_discount_binding;
  DELETE FROM private.uba_redvault_discount_binding
  WHERE discount_code_id = fixture.bound_code_id;
  ALTER TABLE private.uba_redvault_discount_binding
    ENABLE TRIGGER validate_redvault_discount_binding;
END;
$$;
