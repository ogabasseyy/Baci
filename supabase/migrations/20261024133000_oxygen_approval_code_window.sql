-- Read only timing projection. No OTP/activity token, loan mutation, or new execution path.
CREATE INDEX IF NOT EXISTS oxygen_approval_code_commands_idx
ON oxygen_private.commands(workflow_id,completed_at DESC)
WHERE command->>'action'='trigger_approval_otp' AND status='succeeded';

CREATE FUNCTION oxygen_private.approval_code_window(p_workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_reference text; has_token boolean; sent_at timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT s.state->>'bookingReference',s.state ? 'activityToken'
 INTO current_reference,has_token
 FROM public.oxygen_workflows w
 JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
 JOIN public.customers u ON u.id=w.customer_id AND u.merchant_id=w.merchant_id
 LEFT JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
 WHERE w.id=p_workflow_id AND w.environment='staging' AND u.user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF current_reference IS NULL OR NOT coalesce(has_token,false) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE workflow_id=p_workflow_id
   AND command->>'action'='trigger_approval_otp' AND status IN ('queued','executing','indeterminate')) THEN RETURN NULL; END IF;
 -- Use request-start time conservatively: provider/network delay cannot extend the code window.
 SELECT coalesce(c.started_at,c.completed_at) INTO sent_at
 FROM oxygen_private.commands c
 JOIN oxygen_private.provider_reference_history h ON h.command_id=c.id AND h.workflow_id=c.workflow_id
 WHERE c.workflow_id=p_workflow_id AND c.command->>'action'='trigger_approval_otp'
   AND c.status='succeeded' AND h.booking_reference::text=current_reference
 ORDER BY c.completed_at DESC,c.id DESC LIMIT 1;
 IF sent_at IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('bookingReference',current_reference,'sentAt',sent_at,'expiresAt',sent_at+interval '5 minutes');
END $$;
REVOKE ALL ON FUNCTION oxygen_private.approval_code_window(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.approval_code_window(uuid) TO authenticated;
CREATE FUNCTION public.oxygen_approval_code_window(p_workflow_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.approval_code_window(p_workflow_id);
$$;
REVOKE ALL ON FUNCTION public.oxygen_approval_code_window(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_approval_code_window(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
