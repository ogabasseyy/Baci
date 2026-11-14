-- Existing activation evidence remains recoverable even while new dispatch is
-- disabled. Conflicting order state is retained for operator reconciliation;
-- it is never projected as a completed customer order.
CREATE TABLE oxygen_private.general_activation_reconcile_conflicts (
 workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id),
 activation_id uuid NOT NULL REFERENCES oxygen_private.general_activations(id),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz
);
ALTER TABLE oxygen_private.general_activation_reconcile_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.general_activation_reconcile_conflicts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.general_activation_reconcile_conflict(p_workflow_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; a oxygen_private.general_activations%ROWTYPE; o record; s jsonb;
BEGIN
 SELECT * INTO w FROM public.oxygen_workflows WHERE id=p_workflow_id;
 SELECT * INTO a FROM oxygen_private.general_activations WHERE workflow_id=p_workflow_id;
 -- Do not create a review from unconfirmed or unbound evidence.
 IF a.id IS NULL OR a.status IS DISTINCT FROM 'activated' OR a.ciphertext IS NULL
 OR a.workflow_id IS DISTINCT FROM w.id OR a.merchant_id IS DISTINCT FROM w.merchant_id
 OR a.customer_id IS DISTINCT FROM w.customer_id OR a.order_id IS DISTINCT FROM w.order_id
 OR a.environment IS DISTINCT FROM w.environment THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM oxygen_private.general_activation_reconcile_conflicts WHERE workflow_id=w.id AND resolved_at IS NULL) THEN RETURN true; END IF;
 SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o
 FROM public.orders o1 JOIN public.customers c ON c.id=o1.customer_id AND c.merchant_id=o1.merchant_id
 WHERE o1.id=w.order_id AND o1.merchant_id=w.merchant_id AND o1.customer_id=w.customer_id FOR SHARE OF o1,c;
 SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id=w.id FOR UPDATE;
 IF o.total IS NULL OR o.total<=0 OR o.currency IS DISTINCT FROM 'NGN'
 OR o.payment_method IS DISTINCT FROM 'oxygen' OR o.cancelled_at IS NOT NULL
 OR o.payment_status IS DISTINCT FROM 'unpaid' OR a.amount IS DISTINCT FROM o.total
 OR a.application_reference::text IS DISTINCT FROM s->>'applicationReference'
 OR a.booking_reference::text IS DISTINCT FROM s->>'bookingReference'
 OR s->'booking'->>'loan_reference' IS DISTINCT FROM a.booking_reference::text
 OR coalesce(s->'booking'->>'status','') NOT IN ('APPROVED','ACTIVATED')
 OR (CASE WHEN pg_catalog.pg_input_is_valid(s->'booking'->>'product_amount','numeric')
   THEN (s->'booking'->>'product_amount')::numeric IS DISTINCT FROM o.total ELSE true END) THEN
  INSERT INTO oxygen_private.general_activation_reconcile_conflicts(workflow_id,activation_id)
   VALUES(w.id,a.id) ON CONFLICT(workflow_id) DO UPDATE SET activation_id=excluded.activation_id,observed_at=clock_timestamp(),resolved_at=NULL;
  RETURN true;
 END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.general_activation_reconcile_conflict(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $migration$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_catalog.pg_get_functiondef('oxygen_private.general_activation(text,uuid,jsonb)'::regprocedure);
 needle:=$old$p_operation NOT IN ('claim','finish','reconcile')$old$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected activation operations'; END IF;
 definition:=replace(definition,needle,$new$p_operation NOT IN ('claim','finish','reconcile','recover')$new$);
 needle:=$old$ IF p_operation='finish' THEN$old$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected activation finish'; END IF;
 definition:=replace(definition,needle,$new$ IF p_operation='recover' THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Activation unavailable' USING ERRCODE='42501'; END IF;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('status',a.status,'environment',a.environment);
 END IF;
 IF p_operation='finish' THEN$new$);
 needle:=$old$ SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o FROM public.orders o1$old$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected activation order lookup'; END IF;
 definition:=replace(definition,needle,$new$ IF p_operation='reconcile' AND p_payload='{}'::jsonb AND oxygen_private.general_activation_reconcile_conflict(w.id) THEN
  RETURN jsonb_build_object('orderConfirmed',false,'reviewRequired',true);
 END IF;
 SELECT o1.total,o1.currency,o1.payment_method,o1.cancelled_at,o1.payment_status INTO o FROM public.orders o1$new$);
 EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
