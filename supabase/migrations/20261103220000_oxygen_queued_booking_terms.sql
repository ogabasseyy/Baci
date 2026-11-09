-- Reveal only the owned, still-queued command's persisted plan terms.
CREATE FUNCTION public.oxygen_queued_booking_terms(p_workflow_id uuid, p_version integer, p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object('equityPercentage',cmd.command->'equityPercentage','tenure',cmd.command->'tenure')
 FROM public.oxygen_workflows w
 JOIN public.orders o ON o.id=w.order_id AND o.merchant_id=w.merchant_id AND o.customer_id=w.customer_id
 JOIN public.customers customer ON customer.id=w.customer_id AND customer.merchant_id=w.merchant_id
 JOIN oxygen_private.commands cmd ON cmd.workflow_id=w.id
 WHERE auth.uid() IS NOT NULL AND customer.user_id=auth.uid()
   AND w.id=p_workflow_id AND w.version=p_version
   AND cmd.expected_version=p_version AND cmd.idempotency_key=p_key
   AND cmd.status='queued' AND cmd.command->>'action'='book'
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.oxygen_queued_booking_terms(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_queued_booking_terms(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
