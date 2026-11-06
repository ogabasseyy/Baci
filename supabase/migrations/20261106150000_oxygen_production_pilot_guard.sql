-- Production admission is denied until the operator explicitly selects a mode.
-- Existing workflows remain recoverable regardless of subsequent policy changes.
CREATE TABLE oxygen_private.production_admission_policy (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('pilot', 'open'))
);
CREATE TABLE oxygen_private.production_pilot_customers (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (merchant_id, user_id)
);
CREATE INDEX oxygen_production_pilot_customers_user_idx ON oxygen_private.production_pilot_customers(user_id);
ALTER TABLE oxygen_private.production_admission_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxygen_private.production_pilot_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.production_admission_policy FROM PUBLIC, anon, authenticated;
REVOKE ALL ON oxygen_private.production_pilot_customers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION oxygen_private.start_workflow(p_order_id uuid, p_channel text DEFAULT 'web')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order record; v_row public.oxygen_workflows%ROWTYPE; v_environment text;
BEGIN
  SELECT o.id, o.merchant_id, o.customer_id, o.total, o.currency, o.payment_status, o.cancelled_at, o.payment_method
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
  IF v_order.total <= 0 OR v_order.currency IS DISTINCT FROM 'NGN'
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
