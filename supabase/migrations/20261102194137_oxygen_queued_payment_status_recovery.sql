-- Queued status reads have not been dispatched; the workflow lock serializes
-- retirement against claiming. Keep same-key resume for ordinary commands.
CREATE FUNCTION oxygen_private.retire_stale_queued_payment_status(p_workflow uuid,p_key uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.commands SET status='failed',completed_at=clock_timestamp()
 WHERE workflow_id=p_workflow AND command->>'action'='refresh_payment_setup'
  AND status='queued' AND idempotency_key IS DISTINCT FROM p_key
  AND created_at<clock_timestamp()-interval '2 minutes';
$$;
REVOKE ALL ON FUNCTION oxygen_private.retire_stale_queued_payment_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='  IF v_action=''refresh_payment_setup'' AND v_version=w.version THEN';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime payment read guard'; END IF;
 definition:=replace(definition,needle,$replacement$
  IF v_action='refresh_payment_setup' AND v_version=w.version THEN
   PERFORM oxygen_private.retire_stale_queued_payment_status(w.id,v_key);$replacement$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.payment_recovery_access(text,uuid,jsonb)'::regprocedure);
 needle:=' THEN PERFORM oxygen_private.retire_stale_payment_status_read(w.id); END IF;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected payment recovery read guard'; END IF;
 definition:=replace(definition,needle,$replacement$
 THEN
  PERFORM oxygen_private.retire_stale_queued_payment_status(w.id,NULL);
  PERFORM oxygen_private.retire_stale_payment_status_read(w.id);
 END IF;$replacement$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.callback_payment(uuid,uuid,uuid)'::regprocedure);
 needle:=' PERFORM oxygen_private.retire_stale_payment_status_read(w.id);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback payment read guard'; END IF;
 definition:=replace(definition,needle,$replacement$
 PERFORM oxygen_private.retire_stale_queued_payment_status(w.id,NULL);
 PERFORM oxygen_private.retire_stale_payment_status_read(w.id);$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
