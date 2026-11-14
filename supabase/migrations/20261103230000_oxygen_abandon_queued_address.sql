-- Retire only a never-claimed address command before explicit replacement.
-- Workflow-before-command locking matches claim_command.
CREATE FUNCTION public.oxygen_abandon_queued_address(p_workflow_id uuid,p_version integer,p_key uuid,p_reference uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; c oxygen_private.commands%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_workflow_id IS NULL OR p_version IS NULL OR p_key IS NULL OR p_reference IS NULL THEN RETURN false; END IF;
 SELECT w0.* INTO w FROM public.oxygen_workflows w0 WHERE w0.id=p_workflow_id FOR UPDATE;
 IF NOT FOUND OR w.version IS DISTINCT FROM p_version OR w.stage IS DISTINCT FROM 'booked' THEN RETURN false; END IF;
 -- Match runtime lock order: workflow first, then lock and recheck the order
 -- and customer before touching the command.
 PERFORM o.id FROM public.orders o
 JOIN public.customers u ON u.id=o.customer_id AND u.merchant_id=o.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
 AND u.user_id=auth.uid() AND o.payment_method='oxygen' AND o.payment_status='unpaid'
 AND o.cancelled_at IS NULL AND o.currency='NGN' AND o.total>0 FOR SHARE OF o,u;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id
 AND s.state->>'bookingReference'=p_reference::text AND s.state->'booking'->>'status'='BOOKED'
 AND s.state->'kyc'->>'address_status'='NOT_DONE') THEN RETURN false; END IF;
 SELECT * INTO c FROM oxygen_private.commands WHERE workflow_id=w.id AND idempotency_key=p_key FOR UPDATE;
 IF NOT FOUND OR c.expected_version IS DISTINCT FROM p_version OR c.status IS DISTINCT FROM 'queued' OR c.command->>'action' IS DISTINCT FROM 'submit_address' THEN RETURN false; END IF;
 UPDATE oxygen_private.commands SET status='failed',completed_at=clock_timestamp() WHERE id=c.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.oxygen_abandon_queued_address(uuid,integer,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_abandon_queued_address(uuid,integer,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
