-- Every address delivery can refer to a later document review. Rotate its
-- generation even while queued so a stale drainer cannot consume a newer hint.
-- The provider's callback has no stable delivery ID or document version.
DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$    AND deduplication_key=v_key AND status='done';$old$;
 replacement:=$new$    AND deduplication_key=v_key AND status IN ('queued','done');$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected address redelivery guard'; END IF;
 definition:=replace(definition,needle,replacement);

 -- A completion/defer without the fetched generation cannot be safely fenced.
 needle:=$old$ IF p_operation='backlog' THEN$old$;
 replacement:=$new$ IF p_operation IN ('complete','defer') AND (NOT p_payload ? 'retryKey' OR p_payload->>'retryKey' IS NULL) THEN
  RAISE EXCEPTION 'Callback retry key required' USING ERRCODE='22023';
 END IF;
 IF p_operation='backlog' THEN$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback operation guard'; END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$AND (NOT p_payload ? 'retryKey' OR retry_key=(p_payload->>'retryKey')::uuid);$old$;
 replacement:=$new$AND retry_key=(p_payload->>'retryKey')::uuid;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 THEN RAISE EXCEPTION 'Unexpected callback completion fences'; END IF;
 definition:=replace(definition,needle,replacement);

 -- Deferred jobs are scheduled into the future; when due, use that schedule
 -- rather than original arrival time so older retries cannot starve new work.
 needle:=$old$SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO v_result FROM ($old$;
 replacement:=$new$SELECT coalesce(jsonb_agg(item ORDER BY due,received_at,id),'[]'::jsonb) INTO v_result FROM ($new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback pending aggregate'; END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$'workflowIds',to_jsonb(oxygen_private.callback_candidates(p_partner,i.event))) AS item
   FROM (SELECT id,retry_key,event,received_at FROM oxygen_private.callback_inbox$old$;
 replacement:=$new$'workflowIds',to_jsonb(oxygen_private.callback_candidates(p_partner,i.event))) AS item,
    i.next_attempt_at AS due,i.received_at,i.id
   FROM (SELECT id,retry_key,event,received_at,next_attempt_at FROM oxygen_private.callback_inbox$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback pending projection'; END IF;
 definition:=replace(definition,needle,replacement);
 needle:=$old$   ORDER BY i.received_at LIMIT 10$old$;
 replacement:=$new$   ORDER BY i.next_attempt_at,i.received_at,i.id LIMIT 10$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback pending ordering'; END IF;
 definition:=replace(definition,needle,replacement);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
