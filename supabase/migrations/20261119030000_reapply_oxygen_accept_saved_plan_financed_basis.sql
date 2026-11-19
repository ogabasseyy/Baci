-- Reapply financed-amount projection and local-credit verification on
-- public.oxygen_accept_saved_plan(uuid,uuid,integer) after later plan-acceptance
-- migrations replaced it with raw o.total.
DO $$
DECLARE
  definition text := pg_get_functiondef('public.oxygen_accept_saved_plan(uuid,uuid,integer)'::regprocedure);
  old_select text := 'SELECT o.total,o.currency';
  new_select text := 'SELECT oxygen_private.financed_amount(o.id) AS total,o.currency';
  state_anchor text := ' SELECT state INTO current_state FROM oxygen_private.provider_states';
  credit_guard text := ' PERFORM oxygen_private.assert_no_local_credit(w.order_id);';
BEGIN
  IF strpos(definition, new_select) = 0 THEN
    IF (length(definition) - length(replace(definition, old_select, ''))) / length(old_select) <> 1 THEN
      RAISE EXCEPTION 'Unexpected Oxygen cached plan funding projection';
    END IF;
    definition := replace(definition, old_select, new_select);
  END IF;

  IF strpos(definition, credit_guard) = 0 THEN
    IF (length(definition) - length(replace(definition, state_anchor, ''))) / length(state_anchor) <> 1 THEN
      RAISE EXCEPTION 'Unexpected Oxygen cached plan credit proof anchor';
    END IF;
    definition := replace(definition, state_anchor, credit_guard || chr(10) || state_anchor);
  END IF;

  EXECUTE definition;
END $$;
NOTIFY pgrst, 'reload schema';
