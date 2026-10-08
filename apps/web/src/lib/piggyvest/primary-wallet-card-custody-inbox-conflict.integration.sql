\set ON_ERROR_STOP on
\ir primary-wallet-card-custody-inbox.integration.sql
\ir ../../../../../supabase/migrations/20261008092000_primary_card_signed_inbox_conflict_block.sql
SET SESSION AUTHORIZATION baci_primary_card_custody;
UPDATE public.signed_inbox_fixture SET envelope=envelope||'{"eventId":"conflict-custody-receipt"}';
UPDATE public.signed_inbox_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
DO $$ DECLARE fixture record; claim jsonb; element jsonb; BEGIN
 SELECT * INTO fixture FROM public.signed_inbox_fixture;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'conflict proof intake failed'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,encode(convert_to((fixture.envelope||'{"eventData":{"amount":24999}}')::text,'UTF8'),'hex'),repeat('b',128))<>'conflict' THEN RAISE EXCEPTION 'conflicting bytes not quarantined'; END IF;
 IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,fixture.raw_hex,repeat('a',128))<>'conflict' THEN RAISE EXCEPTION 'blocked original redelivered as duplicate'; END IF;
 claim:=piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',fixture.capability,10);
 FOR element IN SELECT * FROM jsonb_array_elements(claim) LOOP
  IF element->>'eventId'='conflict-custody-receipt' THEN RAISE EXCEPTION 'blocked original claimed for settlement'; END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM piggyvest_primary_card.signed_inbox WHERE event_id='conflict-custody-receipt' AND state='blocked' AND reason='proof_conflict') THEN RAISE EXCEPTION 'conflicted original left pending'; END IF;
 IF (SELECT count(*) FROM piggyvest_primary_card.signed_inbox_conflicts WHERE event_id='conflict-custody-receipt')<>1 THEN RAISE EXCEPTION 'conflicting body not preserved'; END IF;
 IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'conflict proof moved funds'; END IF;
END $$;
