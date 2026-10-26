BEGIN;
DO $$
DECLARE
  signature regprocedure;
  definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'piggyvest_primary.notify_paid_interest()'::regprocedure,
    'savings_notifications.interest_recorded()'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(signature);
    IF strpos(definition, ' interest added to your savings. Another step closer to your goal.') > 0 THEN
      CONTINUE;
    END IF;
    IF strpos(definition, ' interest added to your plan. Another step closer to your goal.') = 0 THEN
      RAISE EXCEPTION 'Unexpected interest notification wording';
    END IF;
    EXECUTE replace(definition,
      ' interest added to your plan. Another step closer to your goal.',
      ' interest added to your savings. Another step closer to your goal.');
  END LOOP;
END $$;
COMMIT;
