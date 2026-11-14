-- Early callback workers retired address hints after five failed reads by
-- moving them to observed. Restore only those legacy exhausted hints when a
-- fresh identical delivery identifies exactly one owned application. Ambiguous
-- or uncorrelated events remain quarantined for operator review.
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$    AND deduplication_key=v_key AND status IN ('queued','done');
  END IF;
  RETURN jsonb_build_object('result','duplicate');$old$;
 replacement:=$new$    AND deduplication_key=v_key AND status IN ('queued','done');
   IF nullif(p_payload->>'applicationReference','') IS NOT NULL
    AND cardinality(oxygen_private.callback_candidates(p_partner,p_payload))=1 THEN
    UPDATE oxygen_private.callback_inbox
    SET status='queued',retry_key=gen_random_uuid(),attempts=0,
        received_at=now(),next_attempt_at=now()
    WHERE partner_reference=p_partner AND environment=v_environment
     AND deduplication_key=v_key AND status='observed'
     AND resolution_error IS NULL AND attempts>=5;
   END IF;
  END IF;
  RETURN jsonb_build_object('result','duplicate');$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected Oxygen address redelivery definition';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
