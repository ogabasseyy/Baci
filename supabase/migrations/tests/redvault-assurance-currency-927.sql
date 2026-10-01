DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_storefront_redvault_checkout_summary(uuid)'::regprocedure)
    INTO v_definition;
  IF position('assurance_fee_kobo' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'REDVAULT summary does not expose assurance fees';
  END IF;
END $$;
