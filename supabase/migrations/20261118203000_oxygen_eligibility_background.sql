-- A saved provider PENDING observation opts the same application into bounded
-- status reads. This queue never creates, books or approves an application.
CREATE TABLE oxygen_private.eligibility_jobs (
  workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
  application_reference uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  next_check_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 64),
  claim_key uuid,
  command_id uuid REFERENCES oxygen_private.commands(id) ON DELETE SET NULL,
  notification_status text NOT NULL DEFAULT 'waiting'
    CHECK (notification_status IN ('waiting', 'ready', 'sending', 'sent', 'unconfirmed')),
  claimed_at timestamptz
);
ALTER TABLE oxygen_private.eligibility_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY eligibility_jobs_no_direct_access ON oxygen_private.eligibility_jobs
  AS RESTRICTIVE TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON oxygen_private.eligibility_jobs FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX oxygen_eligibility_jobs_due ON oxygen_private.eligibility_jobs(next_check_at)
WHERE notification_status='waiting';

CREATE FUNCTION oxygen_private.sync_eligibility_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
  IF NEW.stage NOT IN ('eligibility_required','kyc_required','plan_required') THEN RETURN NEW; END IF;
  SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id=NEW.id;
  IF s->>'applicationReference' IS NULL OR s ? 'bookingReference' THEN RETURN NEW; END IF;
  IF s->>'eligibilityStatus'='pending' AND NOT (s ? 'eligible') THEN
    INSERT INTO oxygen_private.eligibility_jobs(workflow_id,application_reference)
    VALUES(NEW.id,(s->>'applicationReference')::uuid)
    ON CONFLICT(workflow_id) DO NOTHING;
  ELSIF NEW.stage IN ('kyc_required','plan_required') AND s->>'eligibilityStatus'='completed'
    AND s->'eligible'='true'::jsonb AND jsonb_array_length(coalesce(s->'offers','[]'::jsonb))>0 THEN
    UPDATE oxygen_private.eligibility_jobs SET notification_status='ready'
    WHERE workflow_id=NEW.id AND application_reference=(s->>'applicationReference')::uuid
      AND notification_status='waiting' AND expires_at>now()
      AND EXISTS (SELECT 1 FROM oxygen_private.commands c
        WHERE c.id=eligibility_jobs.command_id AND c.workflow_id=NEW.id
          AND c.status='succeeded' AND c.expected_version=OLD.version);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.sync_eligibility_job() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_sync_eligibility_job
AFTER UPDATE OF version ON public.oxygen_workflows FOR EACH ROW
WHEN (OLD.version IS DISTINCT FROM NEW.version)
EXECUTE FUNCTION oxygen_private.sync_eligibility_job();

-- Resume recent pending applications created before this queue existed.
INSERT INTO oxygen_private.eligibility_jobs(workflow_id,application_reference,expires_at)
SELECT w.id,(s.state->>'applicationReference')::uuid,w.updated_at+interval '24 hours'
FROM public.oxygen_workflows w JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
WHERE w.stage IN ('eligibility_required','kyc_required')
  AND w.updated_at>now()-interval '24 hours'
  AND s.state->>'applicationReference' IS NOT NULL
  AND s.state->>'eligibilityStatus'='pending'
  AND NOT (s.state ? 'bookingReference' OR s.state ? 'eligible')
ON CONFLICT(workflow_id) DO NOTHING;

-- Add eligibility to the bound worker's existing command machinery. Only
-- explicitly pending pre-booking workflows qualify for worker reconciliation.
DO $migration$
DECLARE
  body text := pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
  marker constant text := $marker$  IF p_operation='reconcile' AND v_action NOT IN ('refresh_kyc','refresh_payment_setup') THEN RAISE EXCEPTION 'Unsupported reconciliation' USING ERRCODE='22023'; END IF;$marker$;
BEGIN
  IF length(body)-length(replace(body,marker,''))<>length(marker) THEN
    RAISE EXCEPTION 'Unexpected Oxygen reconciliation guard';
  END IF;
  EXECUTE replace(body,marker,$replacement$
  IF p_operation='reconcile' AND v_action='refresh_eligibility' THEN
    IF w.stage NOT IN ('eligibility_required','kyc_required')
      OR v_state->>'eligibilityStatus' IS DISTINCT FROM 'pending'
      OR v_state ? 'eligible' OR v_state ? 'bookingReference'
      OR NOT EXISTS (SELECT 1 FROM oxygen_private.eligibility_jobs j WHERE j.workflow_id=w.id
        AND j.application_reference::text=v_state->>'applicationReference'
        AND j.expires_at>now() AND j.notification_status='waiting'
        AND j.claim_key=v_key AND j.next_check_at<=now() AND j.attempts<64) THEN
      RAISE EXCEPTION 'Eligibility is not pending' USING ERRCODE='22023';
    END IF;
  ELSIF p_operation='reconcile' AND v_action NOT IN ('refresh_kyc','refresh_payment_setup') THEN
    RAISE EXCEPTION 'Unsupported reconciliation' USING ERRCODE='22023';
  END IF;$replacement$);
END $migration$;

CREATE FUNCTION public.oxygen_eligibility_background(p_operation text,p_partner text,p_environment text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; queued jsonb; targets jsonb; choice text; new_key uuid;
BEGIN
  IF auth.uid() IS NULL OR p_environment NOT IN ('staging','production')
     OR NOT EXISTS (SELECT 1 FROM oxygen_private.runtime_bindings b
       WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner
         AND b.environment=p_environment AND b.enabled) THEN
    RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501';
  END IF;
  IF p_operation='claim_check' THEN
    SELECT w.id,w.version,c.id AS current_command_id,c.status AS current_command_status INTO candidate
    FROM oxygen_private.eligibility_jobs j
    JOIN public.oxygen_workflows w ON w.id=j.workflow_id
    JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
    JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
    JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
    LEFT JOIN oxygen_private.commands c ON c.id=j.command_id AND c.workflow_id=w.id
      AND c.command->>'action'='refresh_eligibility' AND c.expected_version=w.version
      AND (c.status='queued' OR (c.status='executing' AND c.started_at<now()-interval '10 minutes'))
    WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
      AND b.environment=p_environment AND w.environment=p_environment
      AND w.stage IN ('eligibility_required','kyc_required')
      AND o.cancelled_at IS NULL AND o.payment_status='unpaid' AND o.payment_method='oxygen'
      AND j.notification_status='waiting' AND j.next_check_at<=now()
      AND j.expires_at>now() AND j.attempts<64
      AND s.state->>'applicationReference'=j.application_reference::text
      AND s.state->>'eligibilityStatus'='pending' AND NOT (s.state ? 'bookingReference' OR s.state ? 'eligible')
      AND s.state->'validated'='true'::jsonb
      AND s.state#>>'{kyc,phone_status}'='DONE' AND s.state#>>'{kyc,bvn_status}'='DONE'
      AND s.state#>>'{kyc,selfie_status}'='DONE'
      AND NOT EXISTS (SELECT 1 FROM oxygen_private.commands active WHERE active.workflow_id=w.id
        AND active.status IN ('queued','executing','indeterminate')
        AND active.id IS DISTINCT FROM c.id)
    ORDER BY j.next_check_at,w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF candidate.current_command_status='executing' THEN
      -- This is a worker-owned status read. A dead worker has no provider
      -- mutation to reconcile. Finishing the old command later rolls back.
      PERFORM oxygen_private.record_command(candidate.current_command_id,'failed','eligibility_required');
      candidate.version := candidate.version+1;
    END IF;
    IF candidate.current_command_status IS DISTINCT FROM 'queued' THEN
      new_key := gen_random_uuid();
      UPDATE oxygen_private.eligibility_jobs SET claim_key=new_key WHERE workflow_id=candidate.id;
      queued := oxygen_private.runtime('reconcile',candidate.id,jsonb_build_object(
        'version',candidate.version,'idempotencyKey',new_key,
        'command',jsonb_build_object('action','refresh_eligibility')));
    ELSE
      queued := jsonb_build_object('commandId',candidate.current_command_id);
    END IF;
    UPDATE oxygen_private.eligibility_jobs
      SET claim_key=NULL,attempts=attempts+1,command_id=(queued->>'commandId')::uuid,
          next_check_at=now()+make_interval(mins=>LEAST(30,5*(1<<LEAST(attempts+1,3))))
      WHERE workflow_id=candidate.id;
    RETURN queued || jsonb_build_object('workflowId',candidate.id);
  ELSIF p_operation='claim_notification' AND p_environment='production' THEN
    UPDATE oxygen_private.eligibility_jobs j SET notification_status='unconfirmed'
    FROM public.oxygen_workflows w JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
    WHERE j.workflow_id=w.id AND j.notification_status='sending' AND j.claimed_at<now()-interval '10 minutes'
      AND b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
      AND b.environment=p_environment AND w.environment=p_environment;
    SELECT w.id,w.order_id,w.merchant_id,w.created_channel,cu.user_id,cu.email,m.slug INTO candidate
    FROM oxygen_private.eligibility_jobs j
    JOIN public.oxygen_workflows w ON w.id=j.workflow_id
    JOIN oxygen_private.provider_states s ON s.workflow_id=w.id
    JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
    JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
    JOIN public.customers cu ON cu.id=w.customer_id AND cu.merchant_id=w.merchant_id
    JOIN public.merchants m ON m.id=w.merchant_id
    WHERE b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
      AND b.environment=p_environment AND w.environment=p_environment
      AND j.notification_status='ready' AND j.expires_at>now()
      AND w.stage IN ('kyc_required','plan_required') AND o.cancelled_at IS NULL AND o.payment_status='unpaid' AND o.payment_method='oxygen'
      AND s.state->>'applicationReference'=j.application_reference::text
      AND s.state->>'eligibilityStatus'='completed' AND s.state->'eligible'='true'::jsonb
      AND NOT (s.state ? 'bookingReference')
      AND jsonb_array_length(coalesce(s.state->'offers','[]'::jsonb))>0
      AND NOT EXISTS (SELECT 1 FROM oxygen_private.commands active WHERE active.workflow_id=w.id
        AND active.status IN ('queued','executing','indeterminate'))
    ORDER BY j.next_check_at,w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE oxygen_private.eligibility_jobs SET notification_status='sending',claimed_at=now()
    WHERE workflow_id=candidate.id;
    SELECT to_jsonb(t.token) INTO targets FROM public.push_tokens t
    WHERE candidate.created_channel='mobile' AND t.user_id=candidate.user_id
      AND t.merchant_id=candidate.merchant_id AND t.app_type='storefront' AND t.is_active
    ORDER BY t.last_used_at DESC NULLS LAST,t.id LIMIT 1;
    RETURN jsonb_build_object('workflowId',candidate.id,'orderId',candidate.order_id,
      'merchantId',candidate.merchant_id,'merchantSlug',candidate.slug,'email',candidate.email,'pushToken',targets);
  ELSIF p_operation='finish_notification' AND p_environment='production' THEN
    choice := p_payload->>'status';
    IF choice IS NULL OR choice NOT IN ('sent','unconfirmed') THEN
      RAISE EXCEPTION 'Invalid delivery status' USING ERRCODE='22023';
    END IF;
    UPDATE oxygen_private.eligibility_jobs j SET notification_status=choice
    FROM public.oxygen_workflows w JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
    WHERE j.workflow_id=w.id AND w.id=(p_payload->>'workflowId')::uuid AND j.notification_status='sending'
      AND b.worker_user_id=auth.uid() AND b.partner_reference=p_partner AND b.enabled
      AND b.environment=p_environment AND w.environment=p_environment;
    RETURN jsonb_build_object('recorded',FOUND);
  END IF;
  RAISE EXCEPTION 'Unsupported eligibility job operation' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.oxygen_eligibility_background(text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oxygen_eligibility_background(text,text,text,jsonb) TO authenticated;
