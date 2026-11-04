-- Follow the live activation lock order before modifying rollback-only fixtures.
SELECT id FROM public.oxygen_workflows WHERE id='52ab6696-762b-4e9f-8f99-a9d926a29b2c' FOR UPDATE;
-- Execute after the migration inside a rollback-only transaction. No provider calls.
DO $$ DECLARE owner_id uuid; worker_id uuid; BEGIN
 SELECT c.user_id,b.worker_user_id INTO owner_id,worker_id FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE w.id='52ab6696-762b-4e9f-8f99-a9d926a29b2c';
 PERFORM set_config('test.trial.owner',owner_id::text,true);PERFORM set_config('test.trial.worker',worker_id::text,true);
END $$;
-- Fixtures and failed-prerequisite mutations are rollback-only, including after a real trial.
UPDATE oxygen_private.activation_trials SET status='ready',result='{}',evidence='[]'
WHERE workflow_id='52ab6696-762b-4e9f-8f99-a9d926a29b2c';
SELECT set_config('request.jwt.claim.sub',current_setting('test.trial.owner'),true);
DO $$ BEGIN
 BEGIN
  UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{paymentComplete}','false')
  WHERE workflow_id='52ab6696-762b-4e9f-8f99-a9d926a29b2c';
  UPDATE oxygen_private.payment_recovery SET result=jsonb_set(result,'{paymentComplete}','false')
  WHERE workflow_id='52ab6696-762b-4e9f-8f99-a9d926a29b2c';
  PERFORM public.oxygen_activation_trial('enqueue');
  RAISE EXCEPTION 'Unpaid activation accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  UPDATE public.orders SET cancelled_at=clock_timestamp()
  WHERE id='690a9d2e-33b7-4106-8c68-b9019f814dce';
  PERFORM public.oxygen_activation_trial('enqueue');
  RAISE EXCEPTION 'Cancelled activation accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000099',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_activation_trial('status');RAISE EXCEPTION 'Stranger accessed trial';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.trial.owner'),true);
DO $$ BEGIN
 IF public.oxygen_activation_trial('status')->>'status'<>'ready' THEN RAISE EXCEPTION 'Trial not ready'; END IF;
 BEGIN PERFORM public.oxygen_activation_trial('claim');RAISE EXCEPTION 'Customer claimed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.oxygen_activation_trial('enqueue');
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.trial.worker'),true);
DO $$ BEGIN
 PERFORM public.oxygen_activation_trial('enqueue');
 IF public.oxygen_activation_trial('claim')->>'reference'<>'b75cd437-28af-4008-a1af-7e6810282833' THEN RAISE EXCEPTION 'Wrong reference';END IF;
 IF public.oxygen_activation_trial('claim') IS NOT NULL THEN RAISE EXCEPTION 'Claim repeated';END IF;
 BEGIN PERFORM public.oxygen_activation_trial('finish','{"status":"activated","result":{"loan_reference":"b75cd437-28af-4008-a1af-7e6810282834","status":"ACTIVATED"}}');RAISE EXCEPTION 'Wrong activation accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Activation unconfirmed' THEN RAISE;END IF;END;
 PERFORM public.oxygen_activation_trial('finish','{"status":"activated","result":{"loan_reference":"b75cd437-28af-4008-a1af-7e6810282833","status":"ACTIVATED"}}');
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.trial.owner'),true);
DO $$ BEGIN
 IF public.oxygen_activation_trial('status')->>'status'<>'activated' THEN RAISE EXCEPTION 'Result not visible'; END IF;
 IF public.oxygen_activation_trial('enqueue')->>'status'<>'activated' THEN RAISE EXCEPTION 'Completed trial repeated'; END IF;
 IF has_function_privilege('anon','public.oxygen_activation_trial(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous trial granted';END IF;
END $$;
RESET ROLE;
ROLLBACK;
