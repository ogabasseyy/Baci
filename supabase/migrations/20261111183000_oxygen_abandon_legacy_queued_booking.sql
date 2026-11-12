-- Only an owned, never-claimed legacy approval or booking may be abandoned for offer refresh.
-- Lock order matches the worker claim: workflow first, then command.
CREATE OR REPLACE FUNCTION public.oxygen_abandon_legacy_queued_approval(p_workflow_id uuid,p_version integer,p_key uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; c oxygen_private.commands%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_workflow_id IS NULL OR p_version IS NULL OR p_key IS NULL THEN RETURN false; END IF;
 SELECT w0.* INTO w FROM public.oxygen_workflows w0
 JOIN public.orders o ON o.id=w0.order_id AND o.merchant_id=w0.merchant_id AND o.customer_id=w0.customer_id
 JOIN public.customers u ON u.id=w0.customer_id AND u.merchant_id=w0.merchant_id
 WHERE w0.id=p_workflow_id AND u.user_id=auth.uid()
   AND o.payment_method='oxygen' AND o.payment_status='unpaid' AND o.cancelled_at IS NULL
   AND o.currency='NGN' AND o.total>0
 FOR UPDATE OF w0;
 IF NOT FOUND OR w.version IS DISTINCT FROM p_version THEN RETURN false; END IF;
 SELECT * INTO c FROM oxygen_private.commands WHERE workflow_id=w.id AND idempotency_key=p_key FOR UPDATE;
 IF NOT FOUND OR c.expected_version IS DISTINCT FROM p_version OR c.status IS DISTINCT FROM 'queued'
   OR coalesce(c.command->>'action','') NOT IN ('trigger_approval_otp','approve_booking','book') THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id
   AND s.state->>'applicationReference' IS NOT NULL AND NOT (s.state ? 'offers')
   AND NOT coalesce((s.state->>'paymentComplete')::boolean,false)
   AND NOT coalesce((s.state->>'setupComplete')::boolean,false)
   AND ((c.command->>'action' IN ('trigger_approval_otp','approve_booking')
      AND w.stage IN ('booked','approval_required') AND s.state->'booking'->>'status'='BOOKED' AND s.state->>'bookingReference' IS NOT NULL)
    OR (c.command->>'action'='book' AND ((w.stage='plan_required' AND s.state->>'bookingReference' IS NULL)
      OR (w.stage IN ('booked','approval_required') AND s.state->'booking'->>'status'='BOOKED'
       AND s.state->>'bookingReference' IS NOT NULL AND NOT (s.state ? 'activityToken')))))) THEN RETURN false; END IF;
 UPDATE oxygen_private.commands SET status='failed',completed_at=clock_timestamp() WHERE id=c.id AND status='queued';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.oxygen_abandon_legacy_queued_approval(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_abandon_legacy_queued_approval(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
