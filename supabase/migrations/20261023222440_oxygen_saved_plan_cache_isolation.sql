-- A derived cache must not roll back authoritative provider result persistence.
-- Invalid legacy snapshots or conflicting references are skipped, not repaired.
CREATE OR REPLACE FUNCTION oxygen_private.retain_saved_plan(p_workflow_id uuid,p_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b jsonb; safe_state jsonb; term integer; amount numeric; equity numeric;
BEGIN
 b:=p_state->'booking';
 IF jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR b->>'status' IS DISTINCT FROM 'BOOKED'
  OR b->>'loan_reference' IS NULL
  OR p_state->>'bookingReference' IS DISTINCT FROM b->>'loan_reference'
  OR jsonb_typeof(p_state->'schedule') IS DISTINCT FROM 'array'
  OR jsonb_typeof(b->'loan_tenure') IS DISTINCT FROM 'number'
  OR jsonb_typeof(b->'product_amount') IS DISTINCT FROM 'number'
  OR jsonb_typeof(b->'equity_percentage') IS DISTINCT FROM 'number'
  OR coalesce(b->>'total_charges',p_state->>'quotedCharges') IS NULL THEN RETURN; END IF;
 term:=(b->>'loan_tenure')::integer;
 amount:=(b->>'product_amount')::numeric;
 equity:=(b->>'equity_percentage')::numeric;
 IF term NOT BETWEEN 1 AND 12 OR amount<=0 OR amount>90071992547409.91
  OR equity NOT BETWEEN 25 AND 90 OR equity<>trunc(equity,2)
  OR jsonb_array_length(p_state->'schedule') IS DISTINCT FROM term THEN RETURN; END IF;
 safe_state:=jsonb_build_object('bookingReference',p_state->>'bookingReference',
  'booking',b,'schedule',p_state->'schedule');
 IF p_state ? 'quotedCharges' THEN safe_state:=safe_state||jsonb_build_object('quotedCharges',p_state->'quotedCharges'); END IF;
 INSERT INTO oxygen_private.saved_plans(workflow_id,booking_reference,product_amount,equity_percentage,tenure,state)
 VALUES(p_workflow_id,(b->>'loan_reference')::uuid,amount,equity,term,safe_state)
 ON CONFLICT(workflow_id,product_amount,equity_percentage,tenure) DO UPDATE
 SET state=excluded.state,updated_at=now()
 WHERE oxygen_private.saved_plans.booking_reference=excluded.booking_reference;
EXCEPTION WHEN OTHERS THEN
 -- Never log provider state, credentials or database exception details.
 -- The caller can still persist the provider result and complete its command.
 RAISE LOG 'oxygen_saved_plan_cache_skipped';
 RETURN;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.retain_saved_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
