-- Preserve existing functions and authorize only the workflow's configured binding.
-- No request supplies an environment; worker diagnostics remain worker-scoped.
DO $$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('public.oxygen_saved_plans(uuid,uuid)'::regprocedure);
 needle:='w.id=p_workflow_id AND c.user_id=auth.uid() AND w.environment=''staging''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen saved plans definition'; END IF;
 definition:=replace(definition,needle,$replacement$w.id=p_workflow_id AND c.user_id=auth.uid()
 AND EXISTS (SELECT 1 FROM oxygen_private.runtime_bindings b WHERE b.merchant_id=w.merchant_id
  AND b.enabled AND b.environment=w.environment)$replacement$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.finish_failure(uuid,text,text,jsonb)'::regprocedure);
 needle:='b.environment=''staging'' AND w.environment=''staging''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen failure definition'; END IF;
 definition:=replace(definition,needle,'b.environment=w.environment');
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.error_report(uuid)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen error report definition'; END IF;
 definition:=replace(definition,needle,'b.environment=w.environment');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
