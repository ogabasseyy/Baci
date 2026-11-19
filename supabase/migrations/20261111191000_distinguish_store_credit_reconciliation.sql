-- Existing invoice and ledger conflicts require reconciliation. Preserve
-- serialization_failure for lock contention and stale transaction snapshots.
DO $$
DECLARE
 definition text := pg_get_functiondef('public.record_order_store_credit(uuid)'::regprocedure);
 needle text := 'RAISE EXCEPTION ''Store credit reconciliation required'' USING ERRCODE=''40001''';
BEGIN
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected store credit reconciliation guard';
 END IF;
 EXECUTE replace(definition,needle,replace(needle,'''40001''','''23514'''));
END $$;
