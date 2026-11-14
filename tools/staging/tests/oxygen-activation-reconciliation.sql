-- Run only in the isolated Oxygen staging database, after the reconciliation migration.
-- Every fixture change rolls back. No provider request or payment-status mutation occurs.
BEGIN;
DO $$
DECLARE target_workflow uuid:='1c0459fe-2d45-4d2c-b41a-0ac640ad9f89';
 reference uuid:='1e65cf4b-4942-4ade-8149-e894687f6c40';
 worker_id uuid; owner_id uuid; before_state jsonb; before_payment text;
 old_version integer; after_version integer; old_evidence jsonb; fingerprint text;
BEGIN
 SELECT c.user_id,b.worker_user_id INTO owner_id,worker_id FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE w.id=target_workflow AND w.environment='staging';
 IF owner_id IS NULL OR worker_id IS NULL THEN RAISE EXCEPTION 'Isolated staging fixture missing'; END IF;
 SELECT state INTO before_state FROM oxygen_private.provider_states WHERE provider_states.workflow_id=target_workflow;
 SELECT payment_status INTO before_payment FROM public.orders WHERE id=(SELECT order_id FROM public.oxygen_workflows WHERE id=target_workflow);
 SELECT result INTO old_evidence FROM oxygen_private.activation_trials WHERE activation_trials.workflow_id=target_workflow;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) INTO fingerprint FROM oxygen_private.commands c;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 BEGIN
  PERFORM public.oxygen_reconcile_activation(target_workflow,reference);
  RAISE EXCEPTION 'Customer forged reconciliation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',worker_id::text,true);
 BEGIN
  PERFORM public.oxygen_reconcile_activation(target_workflow,gen_random_uuid());
  RAISE EXCEPTION 'Wrong reference allowed';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 UPDATE oxygen_private.activation_trials SET status='indeterminate' WHERE activation_trials.workflow_id=target_workflow;
 BEGIN
  PERFORM public.oxygen_reconcile_activation(target_workflow,reference);
  RAISE EXCEPTION 'Indeterminate activation treated as confirmed';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 UPDATE oxygen_private.activation_trials SET status='activated' WHERE activation_trials.workflow_id=target_workflow;
 PERFORM public.oxygen_reconcile_activation(target_workflow,reference);
 SELECT version INTO old_version FROM public.oxygen_workflows WHERE id=target_workflow AND stage='activated';
 IF public.oxygen_activation_trial('status',jsonb_build_object('workflowId',target_workflow))->>'orderConfirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Stored status did not expose canonical confirmation'; END IF;
 IF old_version IS NULL THEN RAISE EXCEPTION 'Canonical workflow not reconciled'; END IF;
 PERFORM public.oxygen_reconcile_activation(target_workflow,reference);
 SELECT version INTO after_version FROM public.oxygen_workflows WHERE id=target_workflow;
 IF old_version<>after_version THEN RAISE EXCEPTION 'Reconciliation not idempotent'; END IF;
 IF (SELECT state->>'paymentComplete' FROM oxygen_private.provider_states WHERE provider_states.workflow_id=target_workflow) IS DISTINCT FROM 'true'
 OR (SELECT state->>'setupComplete' FROM oxygen_private.provider_states WHERE provider_states.workflow_id=target_workflow) IS DISTINCT FROM 'true'
 OR (SELECT state->'booking'->>'status' FROM oxygen_private.provider_states WHERE provider_states.workflow_id=target_workflow) IS DISTINCT FROM 'ACTIVATED' THEN RAISE EXCEPTION 'Canonical flags not reconciled'; END IF;
 IF (SELECT payment_status FROM public.orders WHERE id=(SELECT order_id FROM public.oxygen_workflows WHERE id=target_workflow)) IS DISTINCT FROM before_payment THEN RAISE EXCEPTION 'Merchant payment status changed'; END IF;
 IF (SELECT result FROM oxygen_private.activation_trials WHERE activation_trials.workflow_id=target_workflow) IS DISTINCT FROM old_evidence THEN RAISE EXCEPTION 'Provider activation result overwritten'; END IF;
 IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM oxygen_private.commands c) IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Existing commands changed'; END IF;
 RAISE NOTICE 'PASS: worker ownership, exact reference, uncertain-state denial, canonical flags, idempotency, merchant payment and prior commands preserved';
END $$;
ROLLBACK;
