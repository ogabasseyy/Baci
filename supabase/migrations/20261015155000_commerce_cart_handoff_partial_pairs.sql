-- Handoff redemption must preserve incomplete voucher pairs as
-- ordinary lines, matching 20261015151000 and the writer correction in
-- 20261015152000: only a complete token+award pair pins quantity at
-- one. The final coverage implementation still classified a token-only
-- or award-only line as voucher-backed when deriving the expected
-- quantity and when re-inserting staged lines, silently reducing a
-- transferred partial-pair line to quantity one.
DO $repair$
DECLARE definition text; old text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure);
  IF position('v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN' IN definition) = 0 THEN
    old := $old$IF v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'handoff expected-quantity voucher predicate source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$IF v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN$new$);
    old := $old$CASE WHEN (v_line ->> 'voucherToken') IS NOT NULL OR (v_line ->> 'voucherAward') IS NOT NULL$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'handoff insert voucher predicate source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$CASE WHEN (v_line ->> 'voucherToken') IS NOT NULL AND (v_line ->> 'voucherAward') IS NOT NULL$new$);
    EXECUTE definition;
  END IF;
END $repair$;
