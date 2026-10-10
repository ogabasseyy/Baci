\set ON_ERROR_STOP on
\ir primary-wallet-card-custody-inbox.integration.sql
\ir ../../../../../supabase/migrations/20261007201100_primary_card_intake_role.sql
CREATE ROLE baci_primary_card_intake LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
GRANT primary_card_signed_intake TO baci_primary_card_intake;
GRANT SELECT ON public.signed_inbox_fixture TO baci_primary_card_intake;
INSERT INTO piggyvest_primary_card.intake_authority VALUES('10000000-0000-4000-8000-000000000004','baci_primary_card_intake','2099-01-01',true);
UPDATE public.signed_inbox_fixture SET envelope=jsonb_set(envelope,'{eventId}','"role-bound-receipt"')||'{"pvb_reference":"canonical-role-bound"}';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
SET SESSION AUTHORIZATION baci_primary_card_intake;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 IF NOT (piggyvest_primary_card.signed_inbox_readiness('10000000-0000-4000-8000-000000000004','staging',fixture.capability)->>'ready')::boolean THEN RAISE EXCEPTION 'intake not ready'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'intake cannot commit'; END IF;
 IF has_function_privilege(SESSION_USER,'piggyvest_primary_card.claim_signed_inbox(uuid,text,jsonb,integer)','EXECUTE') OR
    has_function_privilege(SESSION_USER,'piggyvest_primary_card.settle_custody(uuid,text,jsonb)','EXECUTE') OR
    has_function_privilege(SESSION_USER,'piggyvest_primary_card.claim_transfer(uuid,text,uuid)','EXECUTE') OR
    has_table_privilege(SESSION_USER,'piggyvest_primary_card.signed_inbox','SELECT') THEN RAISE EXCEPTION 'intake inherited worker authority'; END IF;
 BEGIN
  PERFORM piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,1);
  RAISE EXCEPTION 'intake claimed worker receipt';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging','{}');
  RAISE EXCEPTION 'intake settled ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.intake_authority SET expires_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_card_intake;
DO $$ BEGIN
 BEGIN
  PERFORM piggyvest_primary_card.signed_inbox_readiness('10000000-0000-4000-8000-000000000004','staging',(SELECT capability FROM public.signed_inbox_fixture));
  RAISE EXCEPTION 'expired intake accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE claims jsonb; BEGIN
 claims:=piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT capability FROM public.signed_inbox_fixture),1);
 IF claims->0->>'eventId'<>'role-bound-receipt' THEN RAISE EXCEPTION 'worker cannot claim intake receipt'; END IF;
 IF has_function_privilege(SESSION_USER,'piggyvest_primary_card.claim_transfer(uuid,text,uuid)','EXECUTE') OR has_table_privilege(SESSION_USER,'piggyvest_primary_card.signed_inbox','SELECT') THEN RAISE EXCEPTION 'worker grants too broad'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.settings SET expires_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ BEGIN
 BEGIN
  PERFORM piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',(SELECT capability FROM public.signed_inbox_fixture),1);
  RAISE EXCEPTION 'expired worker claimed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF has_function_privilege('authenticated','piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text)','EXECUTE') OR has_function_privilege('service_role','piggyvest_primary_card.claim_signed_inbox(uuid,text,jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'generic roles inherited authority'; END IF;
END $$;
