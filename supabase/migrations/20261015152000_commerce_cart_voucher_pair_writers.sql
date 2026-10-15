-- Incomplete voucher attachments are ordinary priced lines (see
-- 20261015151000): the quantity-one pin and the merge/set_quantity
-- guards in the add, create, replace, and legacy-import writers must
-- require the complete credential pair, or a partial-pair line added
-- with a real quantity is silently stored at one and can never be
-- restored. Textual repair follows the 20261015151000 pattern.
DO $repair$
DECLARE definition text; old text;
BEGIN
  -- commerce_cart_mutate_authorized_impl: add + replace inserts pin
  -- only complete pairs; merge and set_quantity guards treat only
  -- complete pairs as voucher-backed.
  definition := pg_get_functiondef('public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)'::regprocedure);
  IF position('v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1' IN definition) = 0 THEN
    old := $old$CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 2 THEN
      RAISE EXCEPTION 'mutate voucher pin source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END$new$);
    old := $old$IF v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL THEN$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'mutate add-merge voucher guard source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$IF v_line.voucher_token IS NOT NULL AND v_line.voucher_award_id IS NOT NULL THEN$new$);
    old := $old$IF (v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL)$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'mutate set_quantity voucher guard source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$IF (v_line.voucher_token IS NOT NULL AND v_line.voucher_award_id IS NOT NULL)$new$);
    old := $old$        IF v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'replace duplicate voucher guard source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$        IF v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN$new$);
    EXECUTE definition;
  END IF;

  -- commerce_cart_create_device_impl: same pin and staged-merge guard.
  definition := pg_get_functiondef('public.commerce_cart_create_device_impl(text,jsonb,text)'::regprocedure);
  IF position('v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1' IN definition) = 0 THEN
    old := $old$CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'create voucher pin source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END$new$);
    old := $old$      IF v_staged.voucher_token IS NOT NULL OR v_staged.voucher_award_id IS NOT NULL$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'create staged-merge voucher guard source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$      IF (v_staged.voucher_token IS NOT NULL AND v_staged.voucher_award_id IS NOT NULL)$new$);
    EXECUTE definition;
  END IF;

  -- commerce_cart_migrate_legacy_owner_impl: same pin on import.
  definition := pg_get_functiondef('public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)'::regprocedure);
  IF position('w.voucher_token IS NOT NULL AND w.voucher_award IS NOT NULL THEN 1' IN definition) = 0 THEN
    old := $old$CASE WHEN w.voucher_token IS NOT NULL OR w.voucher_award IS NOT NULL THEN 1 ELSE w.quantity END$old$;
    IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION 'legacy import voucher pin source mismatch';
    END IF;
    definition := replace(definition, old,
      $new$CASE WHEN w.voucher_token IS NOT NULL AND w.voucher_award IS NOT NULL THEN 1 ELSE w.quantity END$new$);
    EXECUTE definition;
  END IF;
END $repair$;
