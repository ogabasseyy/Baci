\set ON_ERROR_STOP on
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='on_email_confirmed') THEN RAISE EXCEPTION 'legacy account-wide trigger retained'; END IF;
 IF (SELECT count(*) FROM public.merchant_onboarding_email_jobs)<>0 THEN RAISE EXCEPTION 'historical merchants backfilled'; END IF;
 IF has_function_privilege('anon','public.claim_merchant_onboarding_email_jobs(integer)','execute') OR has_function_privilege('authenticated','public.get_merchant_onboarding_email_context(uuid)','execute') THEN RAISE EXCEPTION 'worker RPC exposed'; END IF;
 BEGIN UPDATE public.merchant_onboarding_email_control SET enabled=true; RAISE EXCEPTION 'missing provider evidence allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000002','customer@example.com',now(),NULL,NULL);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM merchant_onboarding_email_jobs) THEN RAISE EXCEPTION 'customer enrolled'; END IF; END $$;
INSERT INTO public.merchants(id,user_id,business_name) VALUES('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','New store');
DO $$ BEGIN IF (SELECT count(*) FROM merchant_onboarding_email_jobs)<>5 THEN RAISE EXCEPTION 'journey not enrolled exactly once'; END IF; END $$;
SET ROLE service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.claim_merchant_onboarding_email_jobs()) THEN RAISE EXCEPTION 'disabled worker claimed'; END IF; END $$;
RESET ROLE;
UPDATE public.merchant_onboarding_email_control SET enabled=true,provider_inventory_checked_at=now(),provider_inventory_evidence='Local fixture: no competing automation',support_reply_to='help@example.com';
INSERT INTO public.page_configs VALUES('20000000-0000-4000-8000-000000000002','home');
INSERT INTO public.domains VALUES('20000000-0000-4000-8000-000000000002');
UPDATE public.merchant_onboarding_email_control SET enabled=false;
DO $$ DECLARE context jsonb; BEGIN
 context := public.get_merchant_onboarding_email_context('20000000-0000-4000-8000-000000000002');
 IF (context->>'enabled')::boolean IS DISTINCT FROM true OR (context->>'delivery_enabled')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'global pause conflated with merchant optout'; END IF;
END $$;
UPDATE public.merchant_onboarding_email_control SET enabled=true;
UPDATE public.merchant_onboarding_email_jobs SET due_at=now()-interval '1 minute';
SET ROLE service_role;
DO $$ DECLARE a public.merchant_onboarding_email_jobs; b public.merchant_onboarding_email_jobs; BEGIN
 SELECT j.* INTO a FROM public.claim_merchant_onboarding_email_jobs(1) j;
 SELECT j.* INTO b FROM public.claim_merchant_onboarding_email_jobs(1) j;
 IF a.id IS NULL OR b.id IS NULL OR a.id=b.id THEN RAISE EXCEPTION 'claim isolation failed'; END IF;
 IF public.begin_merchant_onboarding_email_dispatch(a.id,a.claim_token,'wrong@example.com') THEN RAISE EXCEPTION 'changed email accepted'; END IF;
 IF NOT public.begin_merchant_onboarding_email_dispatch(a.id,a.claim_token,'owner@example.com') THEN RAISE EXCEPTION 'dispatch denied'; END IF;
 IF public.begin_merchant_onboarding_email_dispatch(b.id,b.claim_token,'owner@example.com') THEN RAISE EXCEPTION 'same merchant dispatched twice'; END IF;
 IF public.begin_merchant_onboarding_email_dispatch(a.id,a.claim_token,'owner@example.com') THEN RAISE EXCEPTION 'replayed dispatch accepted'; END IF;
END $$;
RESET ROLE;
-- A crashed dispatch is uncertain; only claims with no transport can requeue.
UPDATE public.merchant_onboarding_email_jobs SET claimed_at=now()-interval '1 day' WHERE status='dispatching';
SET ROLE service_role;
SELECT count(*) FROM public.claim_merchant_onboarding_email_jobs(1);
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.merchant_onboarding_email_jobs WHERE status='unknown') THEN RAISE EXCEPTION 'interrupted send not quarantined'; END IF; END $$;
SELECT public.unsubscribe_merchant_onboarding_emails(opt_out_token) FROM public.merchant_onboarding_email_preferences;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM merchant_onboarding_email_preferences WHERE enabled) THEN RAISE EXCEPTION 'optout failed'; END IF; END $$;
UPDATE public.merchants SET user_id='10000000-0000-4000-8000-000000000002' WHERE id='20000000-0000-4000-8000-000000000002';
SET ROLE service_role;
DO $$ BEGIN IF public.get_merchant_onboarding_email_context('20000000-0000-4000-8000-000000000002') IS NOT NULL THEN RAISE EXCEPTION 'reassigned merchant retained journey'; END IF; END $$;
RESET ROLE;
SELECT 'merchant onboarding SQL regressions passed' AS result;
\set ON_ERROR_STOP on
-- Verify actual token capability under anonymous role, without table access.
INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000003','owner3@example.com',now(),NULL,NULL);
INSERT INTO public.merchants(id,user_id,business_name) VALUES('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','Owner3');
UPDATE public.merchant_onboarding_email_preferences SET opt_out_token='30000000-0000-4000-8000-000000000003' WHERE merchant_id='20000000-0000-4000-8000-000000000003';
SET ROLE anon;
SELECT public.unsubscribe_merchant_onboarding_emails('30000000-0000-4000-8000-000000000003');
RESET ROLE;
DO $$ BEGIN IF (SELECT enabled FROM public.merchant_onboarding_email_preferences WHERE merchant_id='20000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'anonymous opt-out failed'; END IF; END $$;
