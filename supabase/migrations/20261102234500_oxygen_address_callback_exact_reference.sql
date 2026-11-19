-- Phone numbers are not application identifiers. Keep uncorrelated callbacks
-- for operator review, even if only one workflow currently matches the phone.
ALTER TABLE oxygen_private.callback_inbox DROP CONSTRAINT callback_inbox_resolution_error_check;
ALTER TABLE oxygen_private.callback_inbox ADD CONSTRAINT callback_inbox_resolution_error_check
 CHECK (resolution_error IS NULL OR resolution_error IN ('ambiguous_address','missing_application_reference'));

DO $$
DECLARE definition text; needle text;
BEGIN
 definition := pg_get_functiondef('oxygen_private.callback_candidates(text,jsonb)'::regprocedure);
 needle := 'AND (NOT p_event ? ''applicationReference'' OR s.state->>''applicationReference''=p_event->>''applicationReference'')';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen address candidate definition'; END IF;
 definition := replace(definition,needle,'AND nullif(p_event->>''applicationReference'','''') IS NOT NULL AND s.state->>''applicationReference''=p_event->>''applicationReference''');
 EXECUTE definition;

 definition := pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle := '  -- Legacy phone-only notifications must never fan out across applications.';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback pending definition'; END IF;
 definition := replace(definition,needle,$replacement$
  -- Do not attribute phone-only events to a possibly unrelated application.
  UPDATE oxygen_private.callback_inbox i SET status='observed',resolution_error='missing_application_reference'
   WHERE i.id IN (SELECT id FROM oxygen_private.callback_inbox
    WHERE partner_reference=p_partner AND environment=v_environment AND status='queued'
      AND event->>'kind'='address' AND nullif(event->>'applicationReference','') IS NULL
    ORDER BY next_attempt_at,received_at LIMIT 100);
  -- Legacy phone-only notifications must never fan out across applications.$replacement$);
 EXECUTE definition;
END $$;
