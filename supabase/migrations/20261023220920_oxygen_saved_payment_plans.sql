-- Confirmed provider plans are private financial snapshots, never quote guesses.
CREATE TABLE oxygen_private.saved_plans (
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
 booking_reference uuid NOT NULL,
 product_amount numeric NOT NULL CHECK(product_amount>0),
 equity_percentage numeric NOT NULL CHECK(equity_percentage BETWEEN 25 AND 90),
 tenure integer NOT NULL CHECK(tenure BETWEEN 1 AND 12),
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workflow_id,product_amount,equity_percentage,tenure),
 UNIQUE(workflow_id,booking_reference)
);
ALTER TABLE oxygen_private.saved_plans ENABLE ROW LEVEL SECURITY;
CREATE TABLE oxygen_private.plan_selections (
 workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
 booking_reference uuid NOT NULL,
 FOREIGN KEY(workflow_id,booking_reference) REFERENCES oxygen_private.saved_plans(workflow_id,booking_reference)
);
ALTER TABLE oxygen_private.plan_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.saved_plans,oxygen_private.plan_selections FROM PUBLIC,anon,authenticated;

-- No API accepts client-authored plan snapshots. This helper is trigger/operator only.
CREATE FUNCTION oxygen_private.retain_saved_plan(p_workflow_id uuid,p_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b jsonb; safe_state jsonb;
BEGIN
 b:=p_state->'booking';
 IF b->>'status' IS DISTINCT FROM 'BOOKED' OR p_state->>'bookingReference' IS DISTINCT FROM b->>'loan_reference'
  OR jsonb_typeof(p_state->'schedule') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_state->'schedule')<>(b->>'loan_tenure')::integer
  OR coalesce(b->>'total_charges',p_state->>'quotedCharges') IS NULL THEN RETURN; END IF;
 safe_state:=jsonb_build_object('bookingReference',p_state->>'bookingReference',
  'booking',b,'schedule',p_state->'schedule');
 IF p_state ? 'quotedCharges' THEN safe_state:=safe_state||jsonb_build_object('quotedCharges',p_state->'quotedCharges'); END IF;
 INSERT INTO oxygen_private.saved_plans(workflow_id,booking_reference,product_amount,equity_percentage,tenure,state)
 VALUES(p_workflow_id,(b->>'loan_reference')::uuid,(b->>'product_amount')::numeric,(b->>'equity_percentage')::numeric,(b->>'loan_tenure')::integer,safe_state)
 ON CONFLICT(workflow_id,product_amount,equity_percentage,tenure) DO UPDATE
 SET state=excluded.state,updated_at=now()
 WHERE oxygen_private.saved_plans.booking_reference=excluded.booking_reference;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.retain_saved_plan(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION oxygen_private.capture_saved_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM oxygen_private.retain_saved_plan(NEW.workflow_id,NEW.state); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION oxygen_private.capture_saved_plan() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retain_oxygen_saved_plan AFTER INSERT OR UPDATE ON oxygen_private.provider_states
FOR EACH ROW EXECUTE FUNCTION oxygen_private.capture_saved_plan();
SELECT oxygen_private.retain_saved_plan(workflow_id,state) FROM oxygen_private.provider_states;

-- Selection is a saved preference, not approval or a mutation of the live loan.
CREATE FUNCTION public.oxygen_saved_plans(p_workflow_id uuid,p_booking_reference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE amount numeric; chosen uuid; answer jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT o.total INTO amount FROM public.oxygen_workflows w
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
REVOKE ALL ON FUNCTION public.oxygen_saved_plans(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_saved_plans(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
