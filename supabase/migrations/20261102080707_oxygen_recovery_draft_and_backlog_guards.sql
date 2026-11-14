-- The same workflow lock serializes the bounded reaper with claim and finish.
-- Only check_status is read-only; queued or executing resends are never retired.
CREATE OR REPLACE FUNCTION oxygen_private.reclaim_stale_payment_check(p_workflow_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE oxygen_private.payment_recovery
 SET status='failed',completed_at=clock_timestamp()
 WHERE workflow_id=p_workflow_id AND action='check_status'
  AND ((status='queued' AND created_at<clock_timestamp()-interval '2 minutes')
   OR (status='executing' AND coalesce(started_at,created_at)<clock_timestamp()-interval '2 minutes'));
$$;

-- Bind the draft row to the exact customer and merchant, even if a later
-- workflow visibility policy becomes broader than the customer-only policy.
DROP POLICY oxygen_draft_read ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_read ON public.oxygen_form_drafts FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) AND EXISTS (
 SELECT 1 FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=oxygen_form_drafts.workflow_id AND c.user_id=(SELECT auth.uid())
));
DROP POLICY oxygen_draft_insert ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_insert ON public.oxygen_form_drafts FOR INSERT TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()) AND version=1 AND EXISTS (
 SELECT 1 FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=oxygen_form_drafts.workflow_id AND c.user_id=(SELECT auth.uid()) AND w.stage='application_required'
));
DROP POLICY oxygen_draft_update ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_update ON public.oxygen_form_drafts FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) AND EXISTS (
 SELECT 1 FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=oxygen_form_drafts.workflow_id AND c.user_id=(SELECT auth.uid()) AND w.stage='application_required'
))
WITH CHECK (user_id=(SELECT auth.uid()) AND EXISTS (
 SELECT 1 FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=oxygen_form_drafts.workflow_id AND c.user_id=(SELECT auth.uid()) AND w.stage='application_required'
));
DROP POLICY oxygen_draft_delete ON public.oxygen_form_drafts;
CREATE POLICY oxygen_draft_delete ON public.oxygen_form_drafts FOR DELETE TO authenticated
USING (user_id=(SELECT auth.uid()) AND EXISTS (
 SELECT 1 FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=oxygen_form_drafts.workflow_id AND c.user_id=(SELECT auth.uid())
));

-- Expose only a capped aggregate to the already-bound worker; never expose
-- callback identifiers or payloads. Scan at most 1001 oldest pending rows.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=' IF p_operation=''accept'' THEN';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected callback definition'; END IF;
 definition:=replace(definition,needle,$replacement$
 IF p_operation='backlog' THEN
  IF p_payload IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid backlog request' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
   'pendingCount',least(count(*),1000),
   'capped',count(*)>1000,
   'oldestAgeSeconds',CASE WHEN count(*)=0 THEN NULL ELSE
    least(2147483647,greatest(0,floor(extract(epoch FROM (clock_timestamp()-min(received_at))))))::integer END
  ) INTO v_result FROM (
   SELECT received_at FROM oxygen_private.callback_inbox
   WHERE partner_reference=p_partner AND environment=v_environment AND status='queued'
   ORDER BY received_at LIMIT 1001
  ) bounded;
  RETURN v_result;
 END IF;
 IF p_operation='accept' THEN$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
