-- A provider-authorized staging retry is an operator decision, never a customer
-- inference from HTTP 500. Keep its uncertain evidence and record that decision.
ALTER TABLE oxygen_private.commands DROP CONSTRAINT commands_status_check;
ALTER TABLE oxygen_private.commands ADD CONSTRAINT commands_status_check
 CHECK(status IN ('queued','executing','succeeded','indeterminate','failed','superseded'));

CREATE TABLE oxygen_private.approval_retry_authorizations (
 command_id uuid PRIMARY KEY REFERENCES oxygen_private.commands(id),
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id),
 booking_reference uuid NOT NULL,
 previous_status text NOT NULL CHECK(previous_status='indeterminate'),
 previous_stage text NOT NULL CHECK(previous_stage='reconciliation_required'),
 previous_version integer NOT NULL,
 provider_authorization text NOT NULL CHECK(length(provider_authorization) BETWEEN 20 AND 1000),
 operator_name text NOT NULL DEFAULT current_user,
 authorized_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oxygen_approval_retry_workflow_idx
 ON oxygen_private.approval_retry_authorizations(workflow_id);
ALTER TABLE oxygen_private.approval_retry_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.approval_retry_authorizations FROM PUBLIC,anon,authenticated;

-- SECURITY INVOKER and no app-role EXECUTE: run only through operator tooling
-- after explicit Oxygen authorization for this exact command and reference.
CREATE FUNCTION oxygen_private.authorize_staging_approval_retry(
 p_workflow uuid,p_command uuid,p_reference uuid,p_expected_version integer,
 p_provider_authorization text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; c oxygen_private.commands%ROWTYPE;
 s jsonb; d jsonb;
BEGIN
 IF p_provider_authorization IS NULL OR length(btrim(p_provider_authorization)) NOT BETWEEN 20 AND 1000 THEN
  RAISE EXCEPTION 'Provider authorization required' USING ERRCODE='22023';
 END IF;
 SELECT id,order_id,merchant_id,customer_id,created_channel,environment,stage,version,created_at,updated_at INTO w FROM public.oxygen_workflows WHERE id=p_workflow FOR UPDATE;
 IF NOT FOUND OR w.environment<>'staging' OR w.stage<>'reconciliation_required'
  OR w.version<>p_expected_version THEN
  RAISE EXCEPTION 'Staging approval recovery unavailable' USING ERRCODE='55000';
 END IF;
 SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at INTO c FROM oxygen_private.commands WHERE id=p_command AND workflow_id=w.id FOR UPDATE;
 IF NOT FOUND OR c.status<>'indeterminate' OR c.command->>'action'<>'approve_booking' THEN
  RAISE EXCEPTION 'Uncertain approval command required' USING ERRCODE='55000';
 END IF;
 SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id=w.id FOR UPDATE;
 SELECT diagnostic INTO d FROM oxygen_private.attempt_diagnostics WHERE command_id=c.id AND workflow_id=w.id;
 IF s->>'bookingReference' IS DISTINCT FROM p_reference::text
  OR s->'booking'->>'loan_reference' IS DISTINCT FROM p_reference::text
  OR s->'booking'->>'status' IS DISTINCT FROM 'BOOKED'
  OR s->'kyc'->>'address_status' IS DISTINCT FROM 'DONE'
  OR coalesce((s->>'paymentComplete')::boolean,false)
  OR coalesce((s->>'setupComplete')::boolean,false)
  OR s ?| ARRAY['paymentUrl','setupUrl']
  OR d->>'operation' IS DISTINCT FROM 'approve'
  OR d->>'httpStatus' IS DISTINCT FROM '500' THEN
  RAISE EXCEPTION 'Approval reference or evidence mismatch' USING ERRCODE='55000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=w.order_id
  AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
  AND o.payment_status='unpaid' AND o.cancelled_at IS NULL AND o.currency='NGN'
  AND o.total=(s->'booking'->>'product_amount')::numeric)
  OR NOT EXISTS(SELECT 1 FROM oxygen_private.runtime_bindings b WHERE b.merchant_id=w.merchant_id
   AND b.environment='staging' AND b.enabled)
  OR EXISTS(SELECT 1 FROM oxygen_private.commands x WHERE x.workflow_id=w.id AND x.id<>c.id
   AND x.status IN ('queued','executing','indeterminate')) THEN
  RAISE EXCEPTION 'Order or workflow unavailable' USING ERRCODE='55000';
 END IF;
 INSERT INTO oxygen_private.approval_retry_authorizations(
  command_id,workflow_id,booking_reference,previous_status,previous_stage,previous_version,provider_authorization
 ) VALUES(c.id,w.id,p_reference,c.status,w.stage,w.version,btrim(p_provider_authorization));
 -- Superseded means explicitly permitted to try again, NOT confirmed failure.
 -- Response evidence, diagnostics and original history are never changed.
 UPDATE oxygen_private.commands SET status='superseded' WHERE id=c.id;
 UPDATE oxygen_private.provider_states SET state=state-'activityToken' WHERE workflow_id=w.id;
 UPDATE public.oxygen_workflows SET stage='approval_required',version=version+1,updated_at=now() WHERE id=w.id;
 INSERT INTO oxygen_private.history(workflow_id,command_id,stage,version)
 VALUES(w.id,c.id,'approval_required',w.version+1);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)
 FROM PUBLIC,anon,authenticated,oxygen_workflow_worker;
