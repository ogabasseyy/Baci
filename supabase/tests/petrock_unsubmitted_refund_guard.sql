-- Requires fixtures/petrock_unsubmitted_refund_guard.sql in an isolated database.
BEGIN;
DO $$ DECLARE reason text; state text; changed boolean; BEGIN
 IF has_function_privilege('anon','public.fail_petrock_remediation_before_acceptance(uuid,text,text)','execute')
 OR has_function_privilege('authenticated','public.fail_petrock_remediation_before_acceptance(uuid,text,text)','execute')
 OR NOT has_function_privilege('service_role','public.fail_petrock_remediation_before_acceptance(uuid,text,text)','execute') THEN
   RAISE EXCEPTION 'replacement changed the existing execution grants';
 END IF;
 FOREACH reason IN ARRAY ARRAY[NULL::text,'','   ','eligibility_evidence_invalid','provider_preflight_failed','paid_recovery_context_missing','paid_recovery_fx_unavailable','paid_recovery_identifier_unavailable'] LOOP
   FOREACH state IN ARRAY ARRAY['paid','submitting','submission_unknown','submitted','in_progress','completed'] LOOP
     DELETE FROM public.petrock_orders;
     INSERT INTO public.petrock_orders(id,status,provider_attempt_started_at,provider_order_id)
     VALUES ('00000000-0000-4000-8000-000000000001',state,now(),CASE WHEN state IN ('submitted','in_progress','completed') THEN 'accepted-1' ELSE NULL END);
     changed := public.fail_petrock_remediation_before_acceptance('00000000-0000-4000-8000-000000000001',reason,'Unsafe assessment');
     IF changed OR EXISTS(SELECT 1 FROM public.test_refund_receipts) OR EXISTS(SELECT 1 FROM public.petrock_order_events)
       OR (SELECT status FROM public.petrock_orders) <> state THEN RAISE EXCEPTION 'already-started order refunded: % / %',state,reason; END IF;
   END LOOP;
 END LOOP;
 -- Even an inconsistent paid row with a provider receipt but no attempt marker is protected.
 UPDATE public.petrock_orders SET status='paid',provider_attempt_started_at=NULL,provider_order_id='accepted-1';
 IF public.fail_petrock_remediation_before_acceptance('00000000-0000-4000-8000-000000000001','eligibility_evidence_invalid','Unsafe') THEN RAISE EXCEPTION 'accepted receipt refunded'; END IF;
 -- Never-submitted paid rejection refunds exactly once through the existing path.
 UPDATE public.petrock_orders SET provider_order_id=NULL;
 IF NOT public.fail_petrock_remediation_before_acceptance('00000000-0000-4000-8000-000000000001','eligibility_evidence_invalid','Refunded') THEN RAISE EXCEPTION 'unsubmitted invalid paid order not refunded'; END IF;
 IF NOT public.fail_petrock_remediation_before_acceptance('00000000-0000-4000-8000-000000000001','eligibility_evidence_invalid','Refunded') THEN RAISE EXCEPTION 'refund replay not idempotent'; END IF;
 IF (SELECT count(*) FROM public.test_refund_receipts) <> 1 OR (SELECT count(*) FROM public.petrock_order_events) <> 1 THEN RAISE EXCEPTION 'duplicate refund/event'; END IF;
 -- Preserve definitive provider-rejection refunds after write-ahead.
 DELETE FROM public.test_refund_receipts; DELETE FROM public.petrock_order_events;
 UPDATE public.petrock_orders SET status='submitting',provider_attempt_started_at=now();
 IF NOT public.fail_petrock_remediation_before_acceptance('00000000-0000-4000-8000-000000000001','provider_submit_rejected','Rejected') THEN RAISE EXCEPTION 'definitive rejection refund regressed'; END IF;
END $$;
ROLLBACK;
