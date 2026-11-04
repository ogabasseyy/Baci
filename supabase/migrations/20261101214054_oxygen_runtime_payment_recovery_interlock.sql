-- Both paths lock the workflow first. Prevent a normal runtime command from
-- changing its version while a recovery attempt is waiting or executing.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:=' IF p_operation IN (''enqueue'',''reconcile'',''claim'') AND EXISTS';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime interlock'; END IF;
 definition:=replace(definition,needle,$replacement$
 IF p_operation IN ('enqueue','reconcile','claim') AND EXISTS
  (SELECT 1 FROM oxygen_private.payment_recovery r WHERE r.workflow_id=w.id AND r.status IN ('queued','executing'))
 THEN RAISE EXCEPTION 'Payment recovery pending' USING ERRCODE='40001'; END IF;
 IF p_operation IN ('enqueue','reconcile','claim') AND EXISTS$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
