-- Keep any wake that could drain queued work for the route's existing filter.
-- This includes unrelated transactions in the same partner/environment and
-- address callbacks for the same application, even when a retry is deferred.
CREATE INDEX oxygen_callback_queued_wake_idx ON oxygen_private.callback_inbox
 (partner_reference,environment,(event->>'kind'),(event->>'applicationReference'))
 WHERE status='queued';
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$  RETURN jsonb_build_object('result','duplicate');$old$;
 replacement:=$new$  RETURN jsonb_build_object('result','duplicate','wakeNeeded',EXISTS(
   SELECT 1 FROM oxygen_private.callback_inbox i
   WHERE i.partner_reference=p_partner AND i.environment=v_environment AND i.status='queued'
    AND i.event->>'kind'=p_payload->>'kind'
    AND (p_payload->>'kind'<>'address' OR i.event->>'applicationReference'=p_payload->>'applicationReference')
  ));$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected Oxygen callback duplicate return';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
