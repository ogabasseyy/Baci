-- A phone alone cannot identify an application. Store these hints as observed
-- immediately, without scheduling a KYC read or coalescing separate deliveries.
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('result','accepted'); END IF;$old$;
 replacement:=$new$  IF v_id IS NOT NULL THEN
   IF p_payload->>'kind'='address' AND nullif(p_payload->>'applicationReference','') IS NULL THEN
    UPDATE oxygen_private.callback_inbox SET status='observed',resolution_error='missing_application_reference'
    WHERE id=v_id AND partner_reference=p_partner AND environment=v_environment;
   END IF;
   RETURN jsonb_build_object('result','accepted');
  END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected Oxygen callback acceptance definition';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
