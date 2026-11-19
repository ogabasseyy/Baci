-- Separate first attempts from retries and blocked attempts; expose no evidence.
CREATE FUNCTION public.oxygen_nin_attempt_status(p_workflow_id uuid, p_version integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((
  SELECT CASE
   WHEN oxygen_private.nin_retry_proof(w.id,p_version) THEN 'safe_retry'
   WHEN w.version=p_version
    AND w.stage IN ('eligibility_required','kyc_required')
    AND s.state->>'validated'='true' AND s.state->>'eligible'='true'
    AND s.state->'kyc'->>'phone_status'='DONE'
    AND s.state->'kyc'->>'bvn_status'='DONE'
    AND s.state->'kyc'->>'selfie_status'='DONE'
    AND s.state->'kyc'->>'nin_status'='NOT_DONE'
    AND NOT (s.state ? 'bookingReference')
    AND NOT EXISTS (SELECT 1 FROM oxygen_private.commands c
      WHERE c.workflow_id=w.id AND (c.command->>'action'='validate_nin'
       OR c.status IN ('queued','executing','indeterminate')))
   THEN 'first_attempt' ELSE 'blocked' END
  FROM public.oxygen_workflows w
  JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
  JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
  JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id AND b.environment=w.environment AND b.enabled
  JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
  WHERE w.id=p_workflow_id AND c.user_id=auth.uid() AND auth.uid() IS NOT NULL
   AND o.payment_method='oxygen' AND o.payment_status='unpaid'
   AND o.cancelled_at IS NULL AND o.currency='NGN' AND o.total>0
 ),'blocked');
$$;
REVOKE ALL ON FUNCTION public.oxygen_nin_attempt_status(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_nin_attempt_status(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
