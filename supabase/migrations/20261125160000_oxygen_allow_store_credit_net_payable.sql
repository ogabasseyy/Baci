-- Allow vouchers, wallet credit, and device savings alongside Oxygen
-- financing as long as a positive net balance remains due, and ensure all
-- Oxygen server-side calculations and validations use the net payable amount
-- (total - pre-gateway store credit) rather than pre-credit order.total.

-- Authoritative net payable calculation including pre-gateway ledger debits
-- (wallet + device savings redemptions) so Oxygen never over-finances if
-- best-effort orders.amount_paid / wallet_amount_used updates fail or lag.
CREATE FUNCTION oxygen_private.order_net_payable_for_order(
  p_order_id uuid,
  p_total numeric,
  p_amount_paid numeric,
  p_wallet_amount_used numeric,
  p_payment_status text DEFAULT 'unpaid'
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_ledger numeric := 0;
  v_has_wallet_reversal boolean := false;
  v_effective_wallet numeric := 0;
  v_savings_ledger numeric := 0;
  v_pre_gateway_credit numeric := 0;
BEGIN
  IF p_total IS NULL
    OR p_total IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  THEN
    RETURN 0;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT
      GREATEST(
        COALESCE(SUM(GREATEST(t.amount, 0)) FILTER (
          WHERE t.source_type = 'order_redemption'
            AND t.type = 'redemption'
            AND t.status = 'completed'
        ), 0) - COALESCE(SUM(GREATEST(t.amount, 0)) FILTER (
          WHERE t.source_type = 'order_reversal'
            AND t.status = 'completed'
        ), 0),
        0
      ),
      COALESCE(BOOL_OR(
        t.source_type = 'order_reversal'
        AND t.status = 'completed'
      ), false)
      INTO v_wallet_ledger, v_has_wallet_reversal
    FROM public.customer_wallet_transactions t
    WHERE t.source_id = p_order_id
      AND t.source_type IN ('order_redemption', 'order_reversal');

    SELECT COALESCE(SUM(GREATEST(r.amount, 0)), 0)
      INTO v_savings_ledger
    FROM public.customer_savings_redemptions r
    WHERE r.order_id = p_order_id
      AND NOT (COALESCE(r.metadata, '{}'::jsonb) ? 'reversed_at');
  END IF;

  v_effective_wallet := CASE
    WHEN v_has_wallet_reversal THEN COALESCE(v_wallet_ledger, 0)
    ELSE GREATEST(COALESCE(p_wallet_amount_used, 0), COALESCE(v_wallet_ledger, 0), 0)
  END;

  IF COALESCE(p_payment_status, 'unpaid') IN ('unpaid', 'pending')
    AND NOT v_has_wallet_reversal THEN
    v_pre_gateway_credit := GREATEST(
      COALESCE(p_amount_paid, 0),
      v_effective_wallet + COALESCE(v_savings_ledger, 0),
      0
    );
  ELSE
    v_pre_gateway_credit := GREATEST(
      v_effective_wallet + COALESCE(v_savings_ledger, 0),
      0
    );
  END IF;

  RETURN GREATEST(round(p_total - v_pre_gateway_credit, 2), 0);
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.order_net_payable_for_order(uuid, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated, service_role;

-- Update the credit admission boundary: store credit is allowed before an
-- Oxygen workflow starts provided a positive net balance remains due; once an
-- Oxygen workflow exists, pre-gateway credit debits on that order are frozen.
CREATE OR REPLACE FUNCTION oxygen_private.assert_no_local_credit(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
BEGIN
  PERFORM oxygen_private.credit_admission_lock(p_order_id);
  SELECT o.total, o.amount_paid, o.wallet_amount_used, o.payment_status
    INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;
  IF FOUND AND oxygen_private.order_net_payable_for_order(
    p_order_id,
    v_order.total,
    v_order.amount_paid,
    v_order.wallet_amount_used,
    v_order.payment_status
  ) <= 0 THEN
    RAISE EXCEPTION 'oxygen_order_total_must_be_positive' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.assert_no_local_credit(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION oxygen_private.guard_local_credit_for_oxygen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old uuid;
  v_new uuid;
  v_order uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_wallet_transactions' THEN
    IF TG_OP = 'UPDATE' AND (OLD.source_id, OLD.source_type, OLD.type, OLD.amount, OLD.status) IS NOT DISTINCT FROM (NEW.source_id, NEW.source_type, NEW.type, NEW.amount, NEW.status) THEN
      RETURN NEW;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND ((OLD.source_type = 'order_redemption' AND OLD.type = 'redemption') OR OLD.source_type = 'order_reversal') THEN
      v_old := OLD.source_id;
    END IF;
    IF TG_OP <> 'DELETE' AND ((NEW.source_type = 'order_redemption' AND NEW.type = 'redemption') OR NEW.source_type = 'order_reversal') THEN
      v_new := NEW.source_id;
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND (OLD.order_id, OLD.amount, OLD.metadata) IS NOT DISTINCT FROM (NEW.order_id, NEW.amount, NEW.metadata) THEN
      RETURN NEW;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_old := OLD.order_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new := NEW.order_id;
    END IF;
  END IF;

  -- Lock in order and allow initial order-creation credit before a workflow
  -- starts; freeze once an Oxygen workflow exists so financed principal cannot drift.
  FOR v_order IN
    SELECT DISTINCT x FROM unnest(ARRAY[v_old, v_new]) AS t(x) WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM oxygen_private.credit_admission_lock(v_order);
    IF EXISTS (SELECT 1 FROM public.oxygen_workflows WHERE order_id = v_order) THEN
      RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.guard_local_credit_for_oxygen() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS oxygen_local_wallet_credit_guard ON public.customer_wallet_transactions;
CREATE TRIGGER oxygen_local_wallet_credit_guard
  BEFORE INSERT OR UPDATE OF source_id, source_type, type, amount, status OR DELETE ON public.customer_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();

DROP TRIGGER IF EXISTS oxygen_local_savings_credit_guard ON public.customer_savings_redemptions;
CREATE TRIGGER oxygen_local_savings_credit_guard
  BEFORE INSERT OR UPDATE OF order_id, amount, metadata OR DELETE ON public.customer_savings_redemptions
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();

CREATE OR REPLACE FUNCTION oxygen_private.guard_order_wallet_for_oxygen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_changed boolean := NEW.wallet_amount_used IS DISTINCT FROM OLD.wallet_amount_used;
  v_unpaid_amount_paid_changed boolean :=
    OLD.payment_status IN ('unpaid', 'pending')
    AND NEW.payment_status IN ('unpaid', 'pending')
    AND NEW.amount_paid IS DISTINCT FROM OLD.amount_paid;
BEGIN
  IF NOT v_wallet_changed AND NOT v_unpaid_amount_paid_changed THEN
    RETURN NEW;
  END IF;
  PERFORM oxygen_private.credit_admission_lock(NEW.id);
  IF EXISTS (SELECT 1 FROM public.oxygen_workflows WHERE order_id = NEW.id) THEN
    RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.guard_order_wallet_for_oxygen() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS oxygen_order_wallet_credit_guard ON public.orders;
CREATE TRIGGER oxygen_order_wallet_credit_guard
  BEFORE UPDATE OF wallet_amount_used, amount_paid ON public.orders
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_wallet_for_oxygen();

-- 1. start_workflow: require positive net payable instead of raw order.total.
CREATE OR REPLACE FUNCTION oxygen_private.start_workflow(p_order_id uuid, p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order record; v_row public.oxygen_workflows%ROWTYPE; v_environment text;
BEGIN
  SELECT o.id, o.merchant_id, o.customer_id, o.total, o.amount_paid, o.wallet_amount_used,
         o.currency, o.payment_status, o.cancelled_at, o.payment_method
    INTO v_order FROM public.orders o JOIN public.customers c
      ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
    WHERE o.id = p_order_id AND c.user_id = auth.uid() FOR SHARE OF o, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('web','mobile','chat') OR p_channel IS NULL THEN
    RAISE EXCEPTION 'Invalid channel' USING ERRCODE = '22023';
  END IF;
  IF v_order.payment_method IS DISTINCT FROM 'oxygen' THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='22023'; END IF;
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO v_row FROM public.oxygen_workflows WHERE order_id = p_order_id
    AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
      'version',v_row.version,'environment',v_row.environment,
      'created_at',v_row.created_at,'updated_at',v_row.updated_at);
  END IF;
  IF oxygen_private.order_net_payable_for_order(v_order.id, v_order.total, v_order.amount_paid, v_order.wallet_amount_used, v_order.payment_status) <= 0
    OR v_order.currency IS DISTINCT FROM 'NGN'
    OR v_order.payment_status <> 'unpaid' OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT b.environment INTO v_environment FROM oxygen_private.runtime_bindings b
    WHERE b.merchant_id=v_order.merchant_id AND b.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE='55000'; END IF;
  IF v_environment = 'production' AND NOT EXISTS (
    SELECT 1 FROM oxygen_private.production_admission_policy p
    WHERE p.merchant_id = v_order.merchant_id AND (
      p.mode = 'open' OR (p.mode = 'pilot' AND EXISTS (
        SELECT 1 FROM oxygen_private.production_pilot_customers a
        WHERE a.merchant_id = v_order.merchant_id AND a.user_id = auth.uid()
      ))
    )
  ) THEN RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.oxygen_workflows(order_id,merchant_id,customer_id,created_channel,environment)
    VALUES (v_order.id,v_order.merchant_id,v_order.customer_id,p_channel,v_environment)
    ON CONFLICT (order_id) DO NOTHING;
  SELECT id, order_id, merchant_id, customer_id, created_channel, environment, stage, version, created_at, updated_at
    INTO STRICT v_row FROM public.oxygen_workflows WHERE order_id = p_order_id AND customer_id = v_order.customer_id AND merchant_id = v_order.merchant_id;
  RETURN jsonb_build_object('id',v_row.id,'order_id',v_row.order_id,'stage',v_row.stage,
    'version',v_row.version,'environment',v_row.environment,
    'created_at',v_row.created_at,'updated_at',v_row.updated_at);
END $$;

-- 2. oxygen_private.runtime: pass and enforce net payable instead of raw order.total.
DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);

  needle := 'SELECT o.total,o.customer_phone';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime order projection count: %', occurrences;
  END IF;
  definition := replace(definition, needle, 'SELECT o.total,o.amount_paid,o.wallet_amount_used,o.customer_phone');

  needle := 'v_order.total<=0';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 2 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime positive total guard count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(w.order_id,v_order.total,v_order.amount_paid,v_order.wallet_amount_used,v_order.payment_status)<=0'
  );

  needle := '''productAmount'',v_order.total,';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime productAmount count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    '''productAmount'',oxygen_private.order_net_payable_for_order(w.order_id,v_order.total,v_order.amount_paid,v_order.wallet_amount_used,v_order.payment_status),'
  );

  needle := '(p_payload->''state''->''booking''->>''product_amount'')::numeric <> v_order.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected Oxygen runtime booking amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    '(p_payload->''state''->''booking''->>''product_amount'')::numeric <> oxygen_private.order_net_payable_for_order(w.order_id,v_order.total,v_order.amount_paid,v_order.wallet_amount_used,v_order.payment_status)'
  );

  EXECUTE definition;
END $migration$;

-- 3. oxygen_saved_plans & oxygen_accept_saved_plan: key plans against net payable.
CREATE OR REPLACE FUNCTION public.oxygen_saved_plans(p_workflow_id uuid,p_booking_reference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE amount numeric; chosen uuid; answer jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT oxygen_private.order_net_payable_for_order(w.order_id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status) INTO amount FROM public.oxygen_workflows w
 JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 WHERE w.id=p_workflow_id AND c.user_id=auth.uid() AND w.environment='staging'
 FOR UPDATE OF w;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF p_booking_reference IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM oxygen_private.saved_plans WHERE workflow_id=p_workflow_id AND booking_reference=p_booking_reference AND product_amount=amount) THEN
   RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='22023';
  END IF;
  INSERT INTO oxygen_private.plan_selections(workflow_id,booking_reference) VALUES(p_workflow_id,p_booking_reference)
  ON CONFLICT(workflow_id) DO UPDATE SET booking_reference=excluded.booking_reference;
 END IF;
 SELECT s.booking_reference INTO chosen FROM oxygen_private.plan_selections s
 JOIN oxygen_private.saved_plans p USING(workflow_id,booking_reference)
 WHERE s.workflow_id=p_workflow_id AND p.product_amount=amount;
 IF chosen IS NULL THEN
  SELECT p.booking_reference INTO chosen FROM oxygen_private.saved_plans p
  LEFT JOIN oxygen_private.provider_states s ON s.workflow_id=p.workflow_id
  WHERE p.workflow_id=p_workflow_id AND p.product_amount=amount
  ORDER BY (p.booking_reference::text=s.state->>'bookingReference') DESC,p.updated_at DESC LIMIT 1;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingReference',booking_reference,
  'productAmount',product_amount,'equityPercentage',equity_percentage,'tenure',tenure,
  'state',state,'updatedAt',updated_at) ORDER BY equity_percentage,tenure),'[]'::jsonb)
 INTO answer FROM oxygen_private.saved_plans WHERE workflow_id=p_workflow_id AND product_amount=amount;
 RETURN jsonb_build_object('plans',answer,'selectedReference',chosen);
END $$;

DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.oxygen_accept_saved_plan(uuid,uuid,integer)'::regprocedure);

  needle := 'SELECT o.total,o.currency,o.payment_status,o.payment_method,o.cancelled_at,c.user_id INTO v_order';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected oxygen_accept_saved_plan projection count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'SELECT o.total,o.amount_paid,o.wallet_amount_used,o.currency,o.payment_status,o.payment_method,o.cancelled_at,c.user_id INTO v_order'
  );

  needle := 'product_amount=v_order.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected oxygen_accept_saved_plan product_amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'product_amount=oxygen_private.order_net_payable_for_order(w.order_id,v_order.total,v_order.amount_paid,v_order.wallet_amount_used,v_order.payment_status)'
  );

  EXECUTE definition;
END $migration$;

-- 4. general_activation, general_activation_reconcile_conflict, reconcile_activation,
--    authorize_staging_approval_retry, nin_retry_proof, oxygen_nin_attempt_status.
DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.general_activation_reconcile_conflict(uuid)'::regprocedure);

  needle := 'SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation_reconcile_conflict projection count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'SELECT o1.id,o1.total,o1.amount_paid,o1.wallet_amount_used,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o'
  );

  needle := 'o.total IS NULL OR o.total<=0';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation_reconcile_conflict positive check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)<=0'
  );

  needle := 'a.amount IS DISTINCT FROM o.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation_reconcile_conflict amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'a.amount IS DISTINCT FROM oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)'
  );

  needle := '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM o.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation_reconcile_conflict booking amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)'
  );

  EXECUTE definition;
END $migration$;

DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.general_activation(text,uuid,jsonb)'::regprocedure);

  needle := 'SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation projection count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'SELECT o1.total,o1.amount_paid,o1.wallet_amount_used,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o'
  );

  needle := 'o.total IS NULL OR o.total<=0';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation positive check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(w.order_id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)<=0'
  );

  needle := '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM o.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation booking amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM oxygen_private.order_net_payable_for_order(w.order_id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)'
  );

  needle := 'a.amount IS DISTINCT FROM o.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'a.amount IS DISTINCT FROM oxygen_private.order_net_payable_for_order(w.order_id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)'
  );

  needle := ',(s->>''bookingReference'')::uuid,o.total,''executing'')';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected general_activation insert count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    ',(s->>''bookingReference'')::uuid,oxygen_private.order_net_payable_for_order(w.order_id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status),''executing'')'
  );

  EXECUTE definition;
END $migration$;

DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.reconcile_activation(uuid,uuid)'::regprocedure);

  needle := 'SELECT o1.id,o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected reconcile_activation projection count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'SELECT o1.id,o1.total,o1.amount_paid,o1.wallet_amount_used,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o'
  );

  needle := '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM o.total';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected reconcile_activation amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    '(s->''booking''->>''product_amount'')::numeric IS DISTINCT FROM oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)'
  );

  EXECUTE definition;
END $migration$;

DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)'::regprocedure);

  needle := 'o.total=(s->''booking''->>''product_amount'')::numeric';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected authorize_staging_approval_retry amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)=(s->''booking''->>''product_amount'')::numeric'
  );

  EXECUTE definition;
END $migration$;

DO $migration$
DECLARE
  definition text;
  needle text;
  occurrences integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef('oxygen_private.nin_retry_proof(uuid,integer)'::regprocedure);
  needle := 'o.total>0';
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected nin_retry_proof amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)>0'
  );
  EXECUTE definition;

  definition := pg_catalog.pg_get_functiondef('public.oxygen_nin_attempt_status(uuid,integer)'::regprocedure);
  occurrences := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Unexpected oxygen_nin_attempt_status amount check count: %', occurrences;
  END IF;
  definition := replace(
    definition,
    needle,
    'oxygen_private.order_net_payable_for_order(o.id,o.total,o.amount_paid,o.wallet_amount_used,o.payment_status)>0'
  );
  EXECUTE definition;
END $migration$;

NOTIFY pgrst, 'reload schema';
