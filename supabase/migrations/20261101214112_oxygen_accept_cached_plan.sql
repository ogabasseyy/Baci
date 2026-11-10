-- Acceptance moves only previously recorded provider facts into the canonical
-- workflow. Browsing preferences remain separate and never change this state.
CREATE FUNCTION public.oxygen_accept_saved_plan(p_workflow_id uuid,p_booking_reference uuid,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; v_order record; current_state jsonb; plan_state jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_booking_reference IS NULL OR p_version IS NULL THEN
  RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501';
 END IF;
 SELECT id,order_id,merchant_id,customer_id,environment,stage,version INTO w.id,w.order_id,w.merchant_id,w.customer_id,w.environment,w.stage,w.version
 FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 SELECT o.total,o.currency,o.payment_status,o.payment_method,o.cancelled_at,c.user_id INTO v_order
 FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,c;
 IF NOT FOUND OR v_order.user_id IS DISTINCT FROM auth.uid() OR NOT EXISTS (
  SELECT 1 FROM oxygen_private.runtime_bindings b WHERE b.merchant_id=w.merchant_id AND b.environment=w.environment AND b.enabled
 ) THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='42501'; END IF;
 SELECT state INTO current_state FROM oxygen_private.provider_states WHERE workflow_id=w.id FOR UPDATE;
 IF NOT FOUND OR w.version<>p_version OR w.stage NOT IN ('booked','approval_required')
 OR v_order.payment_status IS DISTINCT FROM 'unpaid' OR v_order.payment_method IS DISTINCT FROM 'oxygen' OR v_order.cancelled_at IS NOT NULL OR v_order.currency IS DISTINCT FROM 'NGN'
 OR current_state->'booking'->>'status' IS DISTINCT FROM 'BOOKED'
 OR current_state ?| ARRAY['activityToken','paymentUrl','setupUrl']
 OR coalesce((current_state->>'paymentComplete')::boolean,false) OR coalesce((current_state->>'setupComplete')::boolean,false)
 OR EXISTS (SELECT 1 FROM oxygen_private.commands WHERE workflow_id=w.id AND (status IN ('queued','executing','indeterminate') OR (command->>'action' IN ('trigger_approval_otp','approve_booking') AND status='succeeded')))
 OR EXISTS (SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id)
 OR EXISTS (SELECT 1 FROM oxygen_private.general_activations WHERE workflow_id=w.id)
 OR EXISTS (SELECT 1 FROM oxygen_private.activation_trials WHERE workflow_id=w.id)
 THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='40001'; END IF;
 SELECT state INTO plan_state FROM oxygen_private.saved_plans
 WHERE workflow_id=w.id AND booking_reference=p_booking_reference AND product_amount=v_order.total;
 IF NOT FOUND OR plan_state->>'bookingReference' IS DISTINCT FROM p_booking_reference::text
 OR plan_state->'booking'->>'loan_reference' IS DISTINCT FROM p_booking_reference::text
 OR plan_state->'booking'->>'status' IS DISTINCT FROM 'BOOKED' THEN
  RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='22023';
 END IF;
 IF current_state->>'bookingReference' IS DISTINCT FROM p_booking_reference::text THEN
  UPDATE oxygen_private.provider_states SET state=(current_state-ARRAY['bookingReference','booking','schedule','quotedCharges'])
   ||jsonb_build_object('bookingReference',plan_state->'bookingReference','booking',plan_state->'booking','schedule',plan_state->'schedule')
   ||CASE WHEN plan_state ? 'quotedCharges' THEN jsonb_build_object('quotedCharges',plan_state->'quotedCharges') ELSE '{}'::jsonb END
  WHERE workflow_id=w.id;
  UPDATE public.oxygen_workflows SET version=version+1,updated_at=now() WHERE id=w.id RETURNING version INTO w.version;
  INSERT INTO oxygen_private.history(workflow_id,stage,version) VALUES(w.id,w.stage,w.version);
 END IF;
 INSERT INTO oxygen_private.plan_selections(workflow_id,booking_reference) VALUES(w.id,p_booking_reference)
 ON CONFLICT(workflow_id) DO UPDATE SET booking_reference=excluded.booking_reference;
 RETURN jsonb_build_object('bookingReference',p_booking_reference,'version',w.version);
END $$;
REVOKE ALL ON FUNCTION public.oxygen_accept_saved_plan(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_accept_saved_plan(uuid,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
