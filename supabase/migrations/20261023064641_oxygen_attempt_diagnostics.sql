-- Sanitized attempt evidence only. Never store provider/request bodies or credentials.
CREATE TABLE oxygen_private.attempt_diagnostics (
 command_id uuid PRIMARY KEY REFERENCES oxygen_private.commands(id) ON DELETE CASCADE,
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
 application_reference uuid,
 booking_reference uuid,
 diagnostic jsonb NOT NULL CHECK (jsonb_typeof(diagnostic)='object' AND pg_catalog.octet_length(diagnostic::text)<=4096),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days'
);
CREATE INDEX oxygen_attempt_diagnostics_workflow_idx ON oxygen_private.attempt_diagnostics(workflow_id,recorded_at DESC);
CREATE INDEX oxygen_attempt_diagnostics_expiry_idx ON oxygen_private.attempt_diagnostics(expires_at);
ALTER TABLE oxygen_private.attempt_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.attempt_diagnostics FROM PUBLIC,anon,authenticated;

-- Definer is required for the private insert; runtime still authenticates the bound
-- ordinary worker and checks command/workflow/order ownership before finishing.
CREATE FUNCTION oxygen_private.finish_failure(p_command_id uuid,p_outcome text,p_stage text,p_diagnostic jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_workflow uuid; v_merchant uuid; v_state jsonb; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_outcome NOT IN ('failed','indeterminate') THEN
  RAISE EXCEPTION 'Unsupported failure' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
  OR pg_catalog.octet_length(p_diagnostic::text)>4096
  OR p_diagnostic-ARRAY['operation','kind','outcome','httpStatus','providerCode','providerMessage','providerRequestId','capture','occurredAt','durationMs']<>'{}'::jsonb
  OR NOT (p_diagnostic ?& ARRAY['operation','kind','outcome','httpStatus','providerCode','providerMessage','providerRequestId','capture','occurredAt','durationMs'])
  OR (p_diagnostic->>'operation' IS NOT NULL AND p_diagnostic->>'operation' NOT IN ('banks','name_enquiry','create','resend_existing','resend_new','validate_existing','validate_new','kyc','nin','selfie','address','eligibility','book','details','cancel','approval_otp','approve','payment'))
  OR p_diagnostic->>'kind' NOT IN ('http','transport','authentication','invalid_response','validation')
  OR p_diagnostic->>'outcome' NOT IN ('not_sent','rejected','indeterminate')
  OR p_diagnostic->>'capture' NOT IN ('parsed','non_json','oversized','unavailable','not_applicable')
  OR length(p_diagnostic->>'providerMessage')>1000
  OR length(p_diagnostic->>'providerCode')>32
  OR length(p_diagnostic->>'providerRequestId')>128
  OR (p_diagnostic->>'durationMs')::integer NOT BETWEEN 0 AND 300000
  OR ((p_diagnostic->>'httpStatus') IS NOT NULL AND (p_diagnostic->>'httpStatus')::integer NOT BETWEEN 100 AND 599)
  OR (p_diagnostic->>'occurredAt')::timestamptz IS NULL THEN
  RAISE EXCEPTION 'Invalid diagnostic' USING ERRCODE='22023';
 END IF;
 -- Validate scalar types; null is allowed only for explicitly nullable fields.
 IF EXISTS (SELECT 1 FROM jsonb_each(p_diagnostic) e WHERE
   (e.key IN ('kind','outcome','capture','occurredAt') AND jsonb_typeof(e.value)<>'string') OR
   (e.key IN ('providerCode','providerMessage','providerRequestId','operation') AND jsonb_typeof(e.value) NOT IN ('string','null')) OR
   (e.key='durationMs' AND jsonb_typeof(e.value)<>'number') OR
   (e.key='httpStatus' AND jsonb_typeof(e.value) NOT IN ('number','null'))) THEN
  RAISE EXCEPTION 'Invalid diagnostic type' USING ERRCODE='22023';
 END IF;
 SELECT w.id,w.merchant_id INTO v_workflow,v_merchant FROM oxygen_private.commands c
 JOIN public.oxygen_workflows w ON w.id=c.workflow_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE c.id=p_command_id AND b.worker_user_id=auth.uid() AND b.enabled
 AND b.environment='staging' AND w.environment='staging' FOR UPDATE OF w,c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501'; END IF;
 -- One transaction: failed intent cannot commit without its diagnostic row.
 v_result:=oxygen_private.runtime('finish',p_command_id,jsonb_build_object('commandId',p_command_id,'outcome',p_outcome,'stage',p_stage));
 SELECT state INTO v_state FROM oxygen_private.provider_states WHERE workflow_id=v_workflow;
 INSERT INTO oxygen_private.attempt_diagnostics(command_id,workflow_id,application_reference,booking_reference,diagnostic)
 VALUES(p_command_id,v_workflow,(v_state->>'applicationReference')::uuid,(v_state->>'bookingReference')::uuid,p_diagnostic);
 -- Opportunistic physical pruning is restricted to this worker's merchant.
 DELETE FROM oxygen_private.attempt_diagnostics d USING public.oxygen_workflows w
 WHERE d.workflow_id=w.id AND w.merchant_id=v_merchant AND d.expires_at<=now();
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.finish_failure(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.finish_failure(uuid,text,text,jsonb) TO authenticated;
CREATE FUNCTION public.oxygen_finish_failure(p_command_id uuid,p_outcome text,p_stage text,p_diagnostic jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.finish_failure(p_command_id,p_outcome,p_stage,p_diagnostic);
$$;
REVOKE ALL ON FUNCTION public.oxygen_finish_failure(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_finish_failure(uuid,text,text,jsonb) TO authenticated;

CREATE FUNCTION oxygen_private.error_report(p_workflow_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.oxygen_workflows w
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE w.id=p_workflow_id AND b.worker_user_id=auth.uid() AND b.enabled
 AND b.environment='staging' AND w.environment='staging') THEN
  RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(item ORDER BY recorded_at DESC),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('commandId',c.id,'workflowId',d.workflow_id,'orderId',w.order_id,
   'action',c.command->>'action','status',c.status,'startedAt',c.started_at,'completedAt',c.completed_at,
   'applicationReference',d.application_reference,'bookingReference',d.booking_reference,
   'recordedAt',d.recorded_at,'expiresAt',d.expires_at,'diagnostic',d.diagnostic) item,d.recorded_at
  FROM oxygen_private.attempt_diagnostics d JOIN oxygen_private.commands c ON c.id=d.command_id
  JOIN public.oxygen_workflows w ON w.id=d.workflow_id
  WHERE d.workflow_id=p_workflow_id AND d.expires_at>now() ORDER BY d.recorded_at DESC LIMIT 100
 ) rows;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.error_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.error_report(uuid) TO authenticated;
CREATE FUNCTION public.oxygen_error_report(p_workflow_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.error_report(p_workflow_id);
$$;
REVOKE ALL ON FUNCTION public.oxygen_error_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_error_report(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
