-- Read-only provider reconciliation, authorized by a durable authenticated callback.
-- Does not clear uncertain approval/booking commands or enable activation/settlement.
CREATE FUNCTION oxygen_private.callback_payment(p_workflow_id uuid,p_callback_id uuid,p_retry_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 i oxygen_private.callback_inbox%ROWTYPE; a oxygen_private.payment_recovery%ROWTYPE;
 provider jsonb; current_ref uuid; cancelled timestamptz; currency text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND OR w.environment<>'staging' THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 IF NOT FOUND OR NOT b.enabled OR b.environment<>'staging' OR b.worker_user_id IS DISTINCT FROM auth.uid()
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM oxygen_private.callback_inbox WHERE id=p_callback_id FOR UPDATE;
 IF NOT FOUND OR i.partner_reference IS DISTINCT FROM b.partner_reference OR i.status<>'queued'
 OR i.next_attempt_at>now() OR i.retry_key IS DISTINCT FROM p_retry_key OR i.event->>'kind' IS DISTINCT FROM 'transaction'
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT state INTO provider FROM oxygen_private.provider_states WHERE workflow_id=w.id;
 current_ref:=(provider->>'bookingReference')::uuid;
 IF current_ref IS NULL OR i.event->>'bookedLoanReference' IS DISTINCT FROM current_ref::text
 THEN RAISE EXCEPTION 'Callback unavailable' USING ERRCODE='42501'; END IF;
 SELECT o.cancelled_at,o.currency INTO cancelled,currency FROM public.orders o
 JOIN public.customers c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id FOR SHARE OF o,c;
 IF NOT FOUND OR cancelled IS NOT NULL OR currency<>'NGN'
 OR w.stage NOT IN ('payment_required','ready_for_activation','reconciliation_required')
 OR (w.stage='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND c.status='indeterminate' AND c.command->>'action'='approve_booking'))
 OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND
 (c.status IN ('queued','executing') OR (c.status='indeterminate' AND c.command->>'action'<>'approve_booking')))
 THEN RAISE EXCEPTION 'Callback recovery blocked' USING ERRCODE='40001'; END IF;
 SELECT * INTO a FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND idempotency_key=p_retry_key;
 IF FOUND THEN
  IF a.action<>'check_status' OR a.expected_version<>w.version OR a.booking_reference<>current_ref THEN RAISE EXCEPTION 'Callback recovery conflict' USING ERRCODE='40001'; END IF;
 ELSE
  -- Workflow lock serializes against customer recovery enqueue/claim.
  IF EXISTS(SELECT 1 FROM oxygen_private.payment_recovery WHERE workflow_id=w.id AND status IN ('queued','executing')) THEN RAISE EXCEPTION 'Callback recovery pending' USING ERRCODE='40001'; END IF;
  INSERT INTO oxygen_private.payment_recovery(workflow_id,booking_reference,expected_version,idempotency_key,action)
  VALUES(w.id,current_ref,w.version,p_retry_key,'check_status') RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('commandId',a.id,'reference',current_ref,'status',a.status);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.callback_payment(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.callback_payment(uuid,uuid,uuid) TO authenticated;
CREATE FUNCTION public.oxygen_callback_payment(p_workflow_id uuid,p_callback_id uuid,p_retry_key uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.callback_payment(p_workflow_id,p_callback_id,p_retry_key);
$$;
REVOKE ALL ON FUNCTION public.oxygen_callback_payment(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_callback_payment(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
