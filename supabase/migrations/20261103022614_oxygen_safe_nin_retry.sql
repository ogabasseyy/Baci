-- Retry admission is derived only from durable command/diagnostic evidence.
-- The caller-facing projection is a boolean; provider diagnostics remain private.
CREATE FUNCTION oxygen_private.nin_retry_proof(p_workflow_id uuid, p_version integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((
  SELECT c.status = 'failed'
   AND d.diagnostic->>'outcome' = 'not_sent'
   AND d.diagnostic->>'operation' IN ('kyc','nin')
   AND d.application_reference::text = s.state->>'applicationReference'
   AND d.expires_at > pg_catalog.now()
   AND w.version = p_version
   AND w.stage IN ('eligibility_required','kyc_required')
   AND s.state->>'validated' = 'true'
   AND s.state->>'eligible' = 'true'
   AND s.state->'kyc'->>'phone_status' = 'DONE'
   AND s.state->'kyc'->>'bvn_status' = 'DONE'
   AND s.state->'kyc'->>'selfie_status' = 'DONE'
   AND s.state->'kyc'->>'nin_status' = 'NOT_DONE'
   AND NOT (s.state ? 'bookingReference')
   AND NOT EXISTS (SELECT 1 FROM oxygen_private.commands active
    WHERE active.workflow_id = w.id AND active.status IN ('queued','executing','indeterminate'))
  FROM public.oxygen_workflows w
  JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
  JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id AND b.environment=w.environment AND b.enabled
  JOIN oxygen_private.provider_states s ON s.workflow_id = w.id
  JOIN LATERAL (
   SELECT id,status FROM oxygen_private.commands
   WHERE workflow_id = w.id AND command->>'action' = 'validate_nin'
   ORDER BY expected_version DESC, created_at DESC, id DESC LIMIT 1
  ) c ON true
  LEFT JOIN oxygen_private.attempt_diagnostics d ON d.command_id = c.id AND d.workflow_id = w.id
  WHERE w.id = p_workflow_id AND o.payment_method='oxygen' AND o.payment_status='unpaid'
   AND o.cancelled_at IS NULL AND o.currency='NGN' AND o.total>0
 ), false);
$$;
REVOKE ALL ON FUNCTION oxygen_private.nin_retry_proof(uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.oxygen_nin_retry_status(p_workflow_id uuid, p_version integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((
  SELECT oxygen_private.nin_retry_proof(w.id,p_version)
  FROM public.oxygen_workflows w
  JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
  JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
  JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id AND b.environment=w.environment AND b.enabled
  WHERE w.id=p_workflow_id AND c.user_id=auth.uid() AND auth.uid() IS NOT NULL
   AND o.payment_method='oxygen' AND o.payment_status='unpaid' AND o.cancelled_at IS NULL AND o.currency='NGN'
 ),false);
$$;
REVOKE ALL ON FUNCTION public.oxygen_nin_retry_status(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_nin_retry_status(uuid,integer) TO authenticated;

-- Existing idempotency matches return before this point. Only a new key is
-- admitted, under runtime's workflow lock, after the latest NIN failure is proven
-- not sent. In-flight, indeterminate, rejected and evidence-free rows stay fenced.
DO $$
DECLARE definition text; needle text := '  IF w.version<>v_version OR w.stage IN (''activated'',''reconciliation_required'') THEN';
BEGIN
 definition := pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 IF strpos(definition, needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen NIN admission definition'; END IF;
 definition := replace(definition, needle, $replacement$
  IF p_operation='enqueue' AND v_action='validate_nin'
   AND EXISTS (SELECT 1 FROM oxygen_private.commands prior WHERE prior.workflow_id=w.id AND prior.command->>'action'='validate_nin')
   AND NOT oxygen_private.nin_retry_proof(w.id,v_version)
  THEN RAISE EXCEPTION 'NIN retry unavailable' USING ERRCODE='40001'; END IF;
  IF w.version<>v_version OR w.stage IN ('activated','reconciliation_required') THEN$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
