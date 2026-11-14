-- Execute after the migration inside a rollback-only transaction. No provider calls.
DO $$ DECLARE owner_id uuid; worker_id uuid; BEGIN
 SELECT c.user_id,b.worker_user_id INTO owner_id,worker_id FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE w.id='b1c11c04-ef5c-4519-963e-a5a9a8d2f951';
 PERFORM set_config('test.trial.owner',owner_id::text,true);PERFORM set_config('test.trial.worker',worker_id::text,true);
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
 IF public.oxygen_activation_trial('claim')->>'reference'<>'438f96ee-37c4-49bb-a56c-51451f9cb624' THEN RAISE EXCEPTION 'Wrong reference';END IF;
 IF public.oxygen_activation_trial('claim') IS NOT NULL THEN RAISE EXCEPTION 'Claim repeated';END IF;
 BEGIN PERFORM public.oxygen_activation_trial('finish','{"status":"activated","result":{"loan_reference":"438f96ee-37c4-49bb-a56c-51451f9cb625","status":"ACTIVATED"}}');RAISE EXCEPTION 'Wrong activation accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Activation unconfirmed' THEN RAISE;END IF;END;
 PERFORM public.oxygen_activation_trial('finish','{"status":"activated","result":{"loan_reference":"438f96ee-37c4-49bb-a56c-51451f9cb624","status":"ACTIVATED"}}');
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('test.trial.owner'),true);
DO $$ BEGIN
 IF public.oxygen_activation_trial('status')->>'status'<>'activated' THEN RAISE EXCEPTION 'Result not visible'; END IF;
 IF public.oxygen_activation_trial('enqueue')->>'status'<>'activated' THEN RAISE EXCEPTION 'Completed trial repeated'; END IF;
 IF has_function_privilege('anon','public.oxygen_activation_trial(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous trial granted';END IF;
END $$;
RESET ROLE;
ROLLBACK;
