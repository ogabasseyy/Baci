-- Oxygen documents /v1/loan-request/get as "Eligibility status" for an existing
-- application. Repeated staging reads are recorded in FRESH-APPLICATION-2026-10-24.md.
-- Repeat safety is inferred from retrieval semantics, not an explicit provider
-- idempotency promise. Only an explicit status retry invokes this reaper.
-- The runtime holds the workflow lock, serializing claim and completion.
CREATE FUNCTION oxygen_private.retire_stale_executing_eligibility(p_workflow uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.commands c SET status='failed',completed_at=clock_timestamp()
 FROM public.oxygen_workflows w JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
 WHERE c.workflow_id=p_workflow AND w.id=c.workflow_id
  AND c.command->>'action'='refresh_eligibility' AND c.status='executing'
  AND c.started_at IS NOT NULL AND c.started_at<clock_timestamp()-interval '2 minutes'
  AND c.expected_version=w.version AND w.stage IN ('eligibility_required','kyc_required')
  AND s.state->>'applicationReference' IS NOT NULL
  AND NOT (s.state ? 'bookingReference') AND NOT (s.state ? 'eligible')
  -- Durable successful history binds legacy commands to their application
  -- generation. Missing history never licenses a retry.
  AND s.state->>'applicationReference'=(
   SELECT r.application_reference::text
   FROM oxygen_private.history h
   JOIN oxygen_private.provider_reference_history r ON r.command_id=h.command_id AND r.workflow_id=h.workflow_id
   JOIN oxygen_private.commands prior ON prior.id=h.command_id AND prior.workflow_id=h.workflow_id
   WHERE h.workflow_id=w.id AND h.version<=c.expected_version AND prior.status='succeeded'
   ORDER BY h.version DESC,h.id DESC LIMIT 1
  );
$$;
REVOKE ALL ON FUNCTION oxygen_private.retire_stale_executing_eligibility(uuid) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='   PERFORM oxygen_private.retire_stale_queued_eligibility(w.id,v_key);';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen eligibility recovery guard'; END IF;
 definition:=replace(definition,needle,needle||E'\n   PERFORM oxygen_private.retire_stale_executing_eligibility(w.id);');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
