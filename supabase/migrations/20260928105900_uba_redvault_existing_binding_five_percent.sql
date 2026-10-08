DO $migration$
DECLARE
  immutability_trigger_enabled "char";
BEGIN
  LOCK TABLE private.uba_redvault_discount_binding IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.discount_codes IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM private.uba_redvault_discount_binding AS binding
    LEFT JOIN public.discount_codes AS code
      ON code.id = binding.discount_code_id
    WHERE binding.partnership IS DISTINCT FROM 'uba_redvault'
      OR binding.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
      OR code.id IS NULL
      OR code.merchant_id IS DISTINCT FROM binding.merchant_id
      OR code.discount_type IS DISTINCT FROM 'percentage'
      OR code.discount_value IS NULL
      OR code.discount_value NOT IN (5, 10)
  ) THEN
    RAISE EXCEPTION 'redvault_existing_discount_binding_invalid';
  END IF;

  SELECT trigger.tgenabled
  INTO STRICT immutability_trigger_enabled
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.discount_codes'::regclass
    AND trigger.tgname = 'prevent_uba_redvault_discount_mutation'
    AND NOT trigger.tgisinternal;
  IF immutability_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'redvault_discount_immutability_guard_not_enabled';
  END IF;

  ALTER TABLE public.discount_codes
    DISABLE TRIGGER prevent_uba_redvault_discount_mutation;
  BEGIN
    UPDATE public.discount_codes AS code
    SET discount_value = 5
    FROM private.uba_redvault_discount_binding AS binding
    WHERE binding.discount_code_id = code.id
      AND binding.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
      AND binding.partnership = 'uba_redvault'
      AND code.discount_type = 'percentage'
      AND code.discount_value = 10;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.discount_codes
      ENABLE TRIGGER prevent_uba_redvault_discount_mutation;
    RAISE;
  END;
  ALTER TABLE public.discount_codes
    ENABLE TRIGGER prevent_uba_redvault_discount_mutation;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.discount_codes'::regclass
      AND trigger.tgname = 'prevent_uba_redvault_discount_mutation'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'O'
  ) OR EXISTS (
    SELECT 1
    FROM private.uba_redvault_discount_binding AS binding
    JOIN public.discount_codes AS code
      ON code.id = binding.discount_code_id
    WHERE code.discount_value IS DISTINCT FROM 5::numeric
  ) THEN
    RAISE EXCEPTION 'redvault_existing_binding_five_percent_conversion_failed';
  END IF;
END;
$migration$;
