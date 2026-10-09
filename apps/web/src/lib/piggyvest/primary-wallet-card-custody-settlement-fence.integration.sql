\set ON_ERROR_STOP on
\set hold_custody 1
\ir primary-wallet-card-custody.integration.sql
\ir ../../../../../supabase/migrations/20261007200900_primary_card_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261007201000_primary_card_signed_inbox_worker.sql
\ir ../../../../../supabase/migrations/20261008090100_primary_card_signed_inbox_deferred_retry.sql
\ir ../../../../../supabase/migrations/20261008092000_primary_card_signed_inbox_conflict_block.sql
\ir ../../../../../supabase/migrations/20261008092400_primary_card_custody_settlement_fence.sql
CREATE TABLE public.fence_fixture(label text PRIMARY KEY,capability jsonb,envelope jsonb,raw_hex text,claim jsonb);
GRANT SELECT,UPDATE ON public.fence_fixture TO baci_primary_card_custody;
INSERT INTO public.fence_fixture(label,capability,envelope)
SELECT custody.label,
 jsonb_build_object('contractId','fixture-contract','evidenceIssuer','fixture-issuer','treasuryWebhookCustomerId','fixture-business','transactionCustomerId','fixture-business',
 'payloadContract','wallet-transfer-outflow-v1','mappingContract','single-transaction-third-party-reference-v1','merchantId',custody.scope->>'merchantId','businessId','fixture-business','expiresAt','2099-01-01T00:00:00Z'),
 jsonb_build_object('eventId',custody.proof->>'eventId','eventType','wallet-transfer.outflow.success','eventCategory','wallet-transfer','customer_id','fixture-business','pvb_wallet','owner-treasury','pvb_reference','canonical-'||custody.label,'eventData',jsonb_build_object('amount',25000,'currency','NGN'))
FROM public.custody_fixture custody;
UPDATE public.fence_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
INSERT INTO piggyvest_primary_card.inbox_capabilities VALUES('10000000-0000-4000-8000-000000000004','fixture-contract','fixture-issuer','fixture-business','fixture-business','wallet-transfer-outflow-v1','single-transaction-third-party-reference-v1',true);
-- Positive path: a live claim settles; a stale token, a substituted body,
-- or a missing row fails closed without touching the ledger.
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE
  inbox record;
  proof jsonb;
  claim jsonb;
  digest text;
BEGIN
  SELECT * INTO inbox FROM public.fence_fixture WHERE label='third@example.test';
  IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,inbox.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'fence intake failed'; END IF;
  claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,2)->0;
  UPDATE public.fence_fixture SET claim=inbox.claim WHERE label='third@example.test';
  digest := encode(sha256(decode(inbox.raw_hex,'hex')),'hex');
  proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='third@example.test')
    ||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',digest,'inboxToken',claim->>'token');
  IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'completed' THEN RAISE EXCEPTION 'fenced settle failed'; END IF;
  BEGIN
    PERFORM piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',jsonb_set(proof,'{inboxToken}','"10000000-0000-4000-8000-000000000009"'));
    RAISE EXCEPTION 'stale claim token settled';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',jsonb_set(proof,'{bodyDigest}',to_jsonb(repeat('f',64))));
    RAISE EXCEPTION 'substituted body settled';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',jsonb_set(proof,'{eventId}','"fence-unknown-event"'));
    RAISE EXCEPTION 'unclaimed event settled';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,claim->>'eventId',(claim->>'token')::uuid,'io_retry') THEN RAISE EXCEPTION 'fence retry not durable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- A reclaimed retry of the settled event still reports duplicate: the
-- token binds the claim, not the settlement identity.
UPDATE piggyvest_primary_card.signed_inbox SET available_at=clock_timestamp()-interval '1 second' WHERE event_id=(SELECT proof->>'eventId' FROM public.custody_fixture WHERE label='third@example.test');
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE
  inbox record;
  proof jsonb;
  claim jsonb;
  digest text;
BEGIN
  SELECT * INTO inbox FROM public.fence_fixture WHERE label='third@example.test';
  claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,2)->0;
  IF claim->>'token'=(SELECT fence.claim->>'token' FROM public.fence_fixture fence WHERE fence.label='third@example.test') THEN RAISE EXCEPTION 'reclaim reused token'; END IF;
  digest := encode(sha256(decode(inbox.raw_hex,'hex')),'hex');
  proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='third@example.test')
    ||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',digest,'inboxToken',claim->>'token');
  IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'duplicate' THEN RAISE EXCEPTION 'reclaimed retry not duplicate'; END IF;
  IF NOT piggyvest_primary_card.finish_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,claim->>'eventId',(claim->>'token')::uuid,'completed') THEN RAISE EXCEPTION 'fence completion not acknowledged'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- Conflict path: a redelivery that arrives after the claim blocks the
-- row, and the in-flight holder's settlement fails instead of crediting.
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE
  inbox record;
  proof jsonb;
  claim jsonb;
  digest text;
BEGIN
  SELECT * INTO inbox FROM public.fence_fixture WHERE label='fourth@example.test';
  IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,inbox.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'conflict intake failed'; END IF;
  claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,2)->0;
  IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,encode(convert_to((inbox.envelope||'{"eventData":{"amount":24999}}')::text,'UTF8'),'hex'),repeat('a',128))<>'conflict' THEN RAISE EXCEPTION 'conflicting redelivery not quarantined'; END IF;
  digest := encode(sha256(decode(inbox.raw_hex,'hex')),'hex');
  proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='fourth@example.test')
    ||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',digest,'inboxToken',claim->>'token');
  BEGIN
    PERFORM piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof);
    RAISE EXCEPTION 'conflict-blocked claim settled';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary_card.settlements)<>1 THEN RAISE EXCEPTION 'fence leaked or duplicated settlement'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.custody_fixture WHERE label='fourth@example.test'))<>'custody_pending' THEN RAISE EXCEPTION 'blocked claim advanced operation'; END IF;
  IF (SELECT available_balance FROM public.customer_wallets WHERE customer_id='40000000-0000-4000-8000-000000000002')<>292 THEN RAISE EXCEPTION 'blocked claim moved bank-only balance'; END IF;
  IF EXISTS(SELECT 1 FROM public.customer_wallet_transactions WHERE customer_id='40000000-0000-4000-8000-000000000002' AND source_type='piggyvest_primary_card_custody') THEN RAISE EXCEPTION 'blocked claim credited wallet'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 THEN RAISE EXCEPTION 'unexpected transaction count'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.signed_inbox WHERE event_id=(SELECT proof->>'eventId' FROM public.custody_fixture WHERE label='fourth@example.test'))<>'blocked' THEN RAISE EXCEPTION 'conflict did not block row'; END IF;
END $$;
