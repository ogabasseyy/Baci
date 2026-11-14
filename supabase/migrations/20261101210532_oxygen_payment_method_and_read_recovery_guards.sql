-- The claim time fences only read-only status checks. A provider mutation is
-- never reclaimed automatically, including resends and ordinary commands.
ALTER TABLE oxygen_private.payment_recovery ADD COLUMN started_at timestamptz;

CREATE FUNCTION oxygen_private.reclaim_stale_payment_check(p_workflow_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.payment_recovery
 SET status='failed',completed_at=clock_timestamp()
 WHERE workflow_id=p_workflow_id AND action='check_status' AND status='executing'
  AND coalesce(started_at,created_at)<clock_timestamp()-interval '2 minutes';
$$;
REVOKE ALL ON FUNCTION oxygen_private.reclaim_stale_payment_check(uuid) FROM PUBLIC,anon,authenticated;

-- Amend exact deployed definitions without losing earlier security fixes.
DO $$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.start_workflow(uuid,text)'::regprocedure);
 needle:='o.total, o.currency, o.payment_status, o.cancelled_at INTO v_order';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen start projection'; END IF;
 definition:=replace(definition,needle,'o.total, o.currency, o.payment_status, o.cancelled_at, o.payment_method INTO v_order');
 needle:='  -- Resume existing liability even after payment; only NEW drafts need unpaid orders.';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen start guard'; END IF;
 definition:=replace(definition,needle,$replace$
  IF v_order.payment_method IS DISTINCT FROM 'oxygen' THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
  -- Resume existing liability even after payment; only NEW drafts need unpaid orders.$replace$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='o.currency,o.payment_status,o.cancelled_at,o.shipping_address';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime projection'; END IF;
 definition:=replace(definition,needle,'o.currency,o.payment_status,o.cancelled_at,o.shipping_address,o.payment_method');
 needle:='coalesce(b.enabled,false) AND b.environment=w.environment AND v_order.payment_status=''unpaid''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen status binding'; END IF;
 definition:=replace(definition,needle,'coalesce(b.enabled,false) AND b.environment=w.environment AND v_order.payment_method=''oxygen'' AND v_order.payment_status=''unpaid''');
 needle:=' IF p_operation IN (''enqueue'',''reconcile'',''claim'') AND EXISTS';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen runtime interlock'; END IF;
 definition:=replace(definition,needle,$replace$
 IF p_operation IN ('enqueue','reconcile','claim') AND v_order.payment_method IS DISTINCT FROM 'oxygen'
 THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
 IF p_operation IN ('enqueue','reconcile','claim') AND EXISTS$replace$);
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.payment_recovery_access(text,uuid,jsonb)'::regprocedure);
 needle:='cancelled timestamptz; current_currency text;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen recovery declaration'; END IF;
 definition:=replace(definition,needle,'cancelled timestamptz; current_currency text; payment_method text;');
 needle:='SELECT u.user_id,o.payment_status,o.cancelled_at,o.currency INTO owner_id,order_status,cancelled,current_currency';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen recovery projection'; END IF;
 definition:=replace(definition,needle,'SELECT u.user_id,o.payment_status,o.cancelled_at,o.currency,o.payment_method INTO owner_id,order_status,cancelled,current_currency,payment_method');
 needle:=' SELECT state INTO provider FROM oxygen_private.provider_states WHERE workflow_id=w.id;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen recovery binding'; END IF;
 definition:=replace(definition,needle,$replace$
 IF p_operation IN ('enqueue','claim') AND payment_method IS DISTINCT FROM 'oxygen'
 THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
 SELECT state INTO provider FROM oxygen_private.provider_states WHERE workflow_id=w.id;$replace$);
 needle:='  SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=(p_payload->>''idempotencyKey'')::uuid;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen recovery enqueue'; END IF;
 definition:=replace(definition,needle,$replace$
  PERFORM oxygen_private.reclaim_stale_payment_check(w.id);
  SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=(p_payload->>'idempotencyKey')::uuid;$replace$);
 needle:='UPDATE oxygen_private.payment_recovery SET status=''executing'' WHERE id=a.id;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen recovery claim'; END IF;
 definition:=replace(definition,needle,'UPDATE oxygen_private.payment_recovery SET status=''executing'',started_at=clock_timestamp() WHERE id=a.id;');
 EXECUTE definition;

 definition:=pg_get_functiondef('oxygen_private.callback_payment(uuid,uuid,uuid)'::regprocedure);
 needle:='provider jsonb; current_ref uuid; cancelled timestamptz; currency text;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback declaration'; END IF;
 definition:=replace(definition,needle,'provider jsonb; current_ref uuid; cancelled timestamptz; currency text; payment_method text;');
 needle:='SELECT o.cancelled_at,o.currency INTO cancelled,currency FROM public.orders o';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback projection'; END IF;
 definition:=replace(definition,needle,'SELECT o.cancelled_at,o.currency,o.payment_method INTO cancelled,currency,payment_method FROM public.orders o');
 needle:='IF NOT FOUND OR cancelled IS NOT NULL OR currency<>''NGN''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback order guard'; END IF;
 definition:=replace(definition,needle,'IF NOT FOUND OR payment_method IS DISTINCT FROM ''oxygen'' OR cancelled IS NOT NULL OR currency<>''NGN''');
 needle:=' SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=p_retry_key;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen callback recovery'; END IF;
 definition:=replace(definition,needle,$replace$
 PERFORM oxygen_private.reclaim_stale_payment_check(w.id);
 SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=p_retry_key;$replace$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
