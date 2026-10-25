-- Customer requests never write provider facts. Only the dedicated worker may
-- execute queued work; production execution is deliberately not provisioned here.
CREATE SCHEMA IF NOT EXISTS oxygen_private;
REVOKE ALL ON SCHEMA oxygen_private FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oxygen_workflow_worker') THEN
    CREATE ROLE oxygen_workflow_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE public.oxygen_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  created_channel text NOT NULL DEFAULT 'web' CHECK (created_channel IN ('web','mobile','chat')),
  environment text NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging','production')),
  stage text NOT NULL DEFAULT 'application_required' CHECK (stage IN (
    'application_required','eligibility_required','kyc_required','plan_required',
    'booked','approval_required','payment_required','ready_for_activation',
    'activated','reconciliation_required')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oxygen_workflows_merchant_idx ON public.oxygen_workflows(merchant_id);
CREATE INDEX oxygen_workflows_customer_idx ON public.oxygen_workflows(customer_id);
ALTER TABLE public.oxygen_workflows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oxygen_workflows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oxygen_workflows TO authenticated;
CREATE POLICY oxygen_workflows_customer_read ON public.oxygen_workflows FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.customers c JOIN public.orders o
  ON o.customer_id = c.id AND o.merchant_id = c.merchant_id
  WHERE c.id = oxygen_workflows.customer_id AND c.user_id = (SELECT auth.uid())
    AND o.id = oxygen_workflows.order_id AND o.merchant_id = oxygen_workflows.merchant_id));

CREATE TABLE oxygen_private.commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id),
  idempotency_key uuid NOT NULL,
  expected_version integer NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web','mobile','chat')),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','executing','succeeded','indeterminate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(workflow_id, idempotency_key)
);
CREATE INDEX oxygen_commands_workflow_idx ON oxygen_private.commands(workflow_id);
CREATE UNIQUE INDEX oxygen_commands_one_pending_idx ON oxygen_private.commands(workflow_id)
  WHERE status IN ('queued','executing','indeterminate');
ALTER TABLE oxygen_private.commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.commands FROM PUBLIC, anon, authenticated;
CREATE TABLE oxygen_private.history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id),
  command_id uuid REFERENCES oxygen_private.commands(id),
  stage text NOT NULL,
  version integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oxygen_history_workflow_idx ON oxygen_private.history(workflow_id);
CREATE INDEX oxygen_history_command_idx ON oxygen_private.history(command_id);
ALTER TABLE oxygen_private.history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE oxygen_private.history_id_seq FROM PUBLIC, anon, authenticated;
-- Future worker login must be explicitly provisioned as a member of this role.
GRANT USAGE ON SCHEMA oxygen_private TO oxygen_workflow_worker;
GRANT SELECT, UPDATE ON public.oxygen_workflows TO oxygen_workflow_worker;
GRANT SELECT, UPDATE ON oxygen_private.commands TO oxygen_workflow_worker;
GRANT SELECT, INSERT ON oxygen_private.history TO oxygen_workflow_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA oxygen_private TO oxygen_workflow_worker;
CREATE POLICY oxygen_worker_state ON public.oxygen_workflows TO oxygen_workflow_worker USING (true) WITH CHECK (true);
CREATE POLICY oxygen_worker_commands ON oxygen_private.commands TO oxygen_workflow_worker USING (true) WITH CHECK (true);
CREATE POLICY oxygen_worker_history ON oxygen_private.history TO oxygen_workflow_worker USING (true) WITH CHECK (true);

-- Narrow ownership-checked write boundary: users cannot grant themselves a stage,
-- provider reference, environment, merchant, payment result or execution status.
CREATE FUNCTION oxygen_private.start_workflow(p_order_id uuid,p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order record; v_row public.oxygen_workflows%ROWTYPE;
BEGIN
  SELECT o.id, o.merchant_id, o.customer_id, o.total, o.currency, o.payment_status, o.cancelled_at INTO v_order FROM public.orders o JOIN public.customers c
    ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
    WHERE o.id = p_order_id AND c.user_id = auth.uid() FOR SHARE OF o, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('web','mobile','chat') OR p_channel IS NULL THEN
    RAISE EXCEPTION 'Invalid channel' USING ERRCODE = '22023';
  END IF;
  -- Resume existing liability even after payment; only NEW drafts need unpaid orders.
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO v_row FROM public.oxygen_workflows WHERE order_id = p_order_id
    AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
      'version',v_row.version,'environment',v_row.environment,
      'created_at',v_row.created_at,'updated_at',v_row.updated_at);
  END IF;
  IF v_order.total <= 0 OR v_order.currency IS DISTINCT FROM 'NGN'
    OR v_order.payment_status <> 'unpaid' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.oxygen_workflows(order_id,merchant_id,customer_id,created_channel)
    VALUES (v_order.id,v_order.merchant_id,v_order.customer_id,p_channel)
    ON CONFLICT (order_id) DO NOTHING;
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO STRICT v_row FROM public.oxygen_workflows WHERE order_id = p_order_id AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
    'version',v_row.version,'environment',v_row.environment,
    'created_at',v_row.created_at,'updated_at',v_row.updated_at);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.start_workflow(uuid,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA oxygen_private TO authenticated;
GRANT EXECUTE ON FUNCTION oxygen_private.start_workflow(uuid,text) TO authenticated;
CREATE FUNCTION public.oxygen_start_workflow(p_order_id uuid,p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT oxygen_private.start_workflow(p_order_id,p_channel);
$$;
REVOKE ALL ON FUNCTION public.oxygen_start_workflow(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oxygen_start_workflow(uuid,text) TO authenticated;

-- Do not expose an enqueue RPC until provider connection/readiness and protected
-- OTP/signature form handling are composed. A durable draft is safe to resume;
-- it cannot initiate any provider action or financial mutation by itself.

CREATE FUNCTION oxygen_private.claim_command(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_command oxygen_private.commands%ROWTYPE; v_stage text; v_version integer; v_environment text;
BEGIN
  -- Always lock workflow before command, matching completion lock order.
  SELECT w.stage,w.version,w.environment INTO v_stage,v_version,v_environment FROM public.oxygen_workflows w
    JOIN oxygen_private.commands c ON c.workflow_id = w.id WHERE c.id = p_id FOR UPDATE OF w;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at,started_at,completed_at
    INTO v_command FROM oxygen_private.commands WHERE id = p_id FOR UPDATE;
  IF v_command.status <> 'queued' THEN RETURN NULL; END IF;
  IF v_command.expected_version <> v_version THEN
    RAISE EXCEPTION 'Stale workflow command' USING ERRCODE = '40001';
  END IF;
  UPDATE oxygen_private.commands SET status = 'executing',started_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('id',v_command.id,'environment',v_environment,'stage',v_stage,'command',v_command.command);
END $$;
CREATE FUNCTION oxygen_private.record_command(p_id uuid,p_outcome text,p_stage text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_workflow uuid; v_status text; v_version integer;
BEGIN
  IF p_outcome NOT IN ('succeeded','indeterminate') OR p_stage = 'activated'
    OR (p_outcome = 'indeterminate' AND p_stage <> 'reconciliation_required') THEN
    RAISE EXCEPTION 'Unsupported workflow result' USING ERRCODE = '22023';
  END IF;
  SELECT w.id,w.version INTO v_workflow,v_version FROM public.oxygen_workflows w
    JOIN oxygen_private.commands c ON c.workflow_id = w.id WHERE c.id = p_id FOR UPDATE OF w;
  IF NOT FOUND THEN RAISE EXCEPTION 'Command not found'; END IF;
  SELECT status INTO v_status FROM oxygen_private.commands WHERE id = p_id FOR UPDATE;
  IF v_status <> 'executing' THEN RAISE EXCEPTION 'Command is not executing'; END IF;
  UPDATE oxygen_private.commands SET status = p_outcome,completed_at = now() WHERE id = p_id;
  UPDATE public.oxygen_workflows SET stage = p_stage,version = v_version + 1,updated_at = now() WHERE id = v_workflow;
  INSERT INTO oxygen_private.history(workflow_id,command_id,stage,version)
    VALUES(v_workflow,p_id,p_stage,v_version + 1);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.claim_command(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION oxygen_private.record_command(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION oxygen_private.claim_command(uuid) TO oxygen_workflow_worker;
GRANT EXECUTE ON FUNCTION oxygen_private.record_command(uuid,text,text) TO oxygen_workflow_worker;
