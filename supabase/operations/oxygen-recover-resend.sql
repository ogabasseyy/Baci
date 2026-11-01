-- Operator-only repair of a NON-FINANCIAL, unconfirmed OTP resend in staging.
-- This abandons local resend intent; it does NOT assert provider failure/delivery.
-- Preserve the original reconciliation history, customer/provider state and IDs.
-- Required psql variables: workflow_id, command_id, expected_version.
-- Dry run by default. Explicit commit_recovery=true is needed to commit.
\if :{?commit_recovery}
\else
  \set commit_recovery false
\endif
BEGIN;
SELECT set_config('oxygen_recovery.workflow', :'workflow_id', true),
       set_config('oxygen_recovery.command', :'command_id', true),
       set_config('oxygen_recovery.version', :'expected_version', true);
DO $$
DECLARE
  wf uuid := current_setting('oxygen_recovery.workflow')::uuid;
  cmd uuid := current_setting('oxygen_recovery.command')::uuid;
  expected integer := current_setting('oxygen_recovery.version')::integer;
  w record;
  c record;
  safe_provider_state boolean;
BEGIN
  SELECT environment, stage, version, order_id INTO STRICT w FROM public.oxygen_workflows WHERE id = wf FOR UPDATE;
  SELECT workflow_id, status, command INTO STRICT c FROM oxygen_private.commands WHERE id = cmd FOR UPDATE;
  SELECT NOT coalesce((state->>'validated')::boolean, false)
    AND state ? 'applicationReference'
    AND NOT (state ?| ARRAY['bookingReference','booking','paymentUrl','setupUrl'])
    AND NOT coalesce((state->>'paymentComplete')::boolean, false)
    AND NOT coalesce((state->>'setupComplete')::boolean, false)
    INTO STRICT safe_provider_state FROM oxygen_private.provider_states WHERE workflow_id = wf FOR UPDATE;
  IF w.environment <> 'staging' OR w.stage <> 'reconciliation_required' OR w.version <> expected
    OR c.workflow_id <> wf OR c.status <> 'indeterminate'
    OR c.command IS DISTINCT FROM '{"action":"resend_customer_otp"}'::jsonb
    OR safe_provider_state IS NOT TRUE
    OR EXISTS (SELECT 1 FROM oxygen_private.commands WHERE workflow_id = wf AND id <> cmd AND status IN ('queued','executing','indeterminate'))
    OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = w.order_id AND payment_status = 'unpaid' AND cancelled_at IS NULL)
  THEN RAISE EXCEPTION 'Not an eligible staging OTP-only repair'; END IF;
  UPDATE oxygen_private.commands SET status = 'failed', completed_at = now() WHERE id = cmd;
  UPDATE public.oxygen_workflows SET stage = 'eligibility_required', version = version + 1, updated_at = now() WHERE id = wf;
  INSERT INTO oxygen_private.history(workflow_id,command_id,stage,version)
    VALUES(wf,cmd,'eligibility_required',expected + 1);
  RAISE NOTICE 'Local OTP resend intent abandoned; provider delivery remains unconfirmed';
END $$;
\if :commit_recovery
COMMIT;
\else
ROLLBACK;
\endif
