-- Coalesce repeated address deliveries without suppressing a later same-status
-- update after the earlier hint was reconciled. No provider mutation is made.
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$  IF v_existing<>v_hash THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('result','duplicate');$old$;
 replacement:=$new$  IF v_existing<>v_hash THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;
  -- The provider supplies no address event ID: a later identical valid hint
  -- may describe a new review. Requeue completed hints, but coalesce queued
  -- duplicates and never revive unresolved/ambiguous observed callbacks.
  IF p_payload->>'kind'='address' THEN
   UPDATE oxygen_private.callback_inbox
   SET status='queued', retry_key=gen_random_uuid(), attempts=0,
       received_at=now(), next_attempt_at=now()
   WHERE partner_reference=p_partner AND environment=v_environment
    AND deduplication_key=v_key AND status='done';
  END IF;
  RETURN jsonb_build_object('result','duplicate');$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback accept definition'; END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued';$old$;
 replacement:=$new$WHERE partner_reference=p_partner AND environment=v_environment AND id=(p_payload->>'id')::uuid AND status='queued'
    AND (NOT p_payload ? 'retryKey' OR retry_key=(p_payload->>'retryKey')::uuid);$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 THEN
  RAISE EXCEPTION 'Unexpected Oxygen callback completion definitions';
 END IF;
 definition:=replace(definition,needle,replacement);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
