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
    ) OR (converted->>'discount_value')::numeric <> 5
    OR unrelated IS DISTINCT FROM (
      SELECT original_row FROM redvault_fixed_five_expected_codes WHERE id = fixture.unrelated_code_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_discount_binding AS binding
      WHERE binding.discount_code_id = fixture.bound_code_id
        AND binding.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'
        AND binding.partnership = 'uba_redvault'
    ) THEN
    RAISE EXCEPTION 'redvault_bound_ten_conversion_or_unrelated_code_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.discount_codes'::regclass
      AND tgname = 'prevent_uba_redvault_discount_mutation'
      AND tgenabled = 'O' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'redvault_discount_immutability_guard_not_restored'; END IF;
  PERFORM pg_temp.assert_redvault_fixed_five_history_unchanged();
END;
$$;

DO $$
DECLARE
  fixture redvault_fixed_five_fixture%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_fixed_five_fixture;
  BEGIN
    UPDATE public.discount_codes SET discount_value = 10 WHERE id = fixture.bound_code_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_discount_binding_is_immutable' THEN
    RAISE EXCEPTION 'redvault_bound_code_immutability_not_restored:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    UPDATE private.uba_redvault_discount_binding
    SET created_at = created_at WHERE discount_code_id = fixture.bound_code_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_discount_binding_is_immutable' THEN
    RAISE EXCEPTION 'redvault_binding_immutability_not_restored:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;
