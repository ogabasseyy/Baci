\set ON_ERROR_STOP on
\set hold_custody 1
\ir primary-wallet-card-custody.integration.sql
\ir ../../../../../supabase/migrations/20261007200900_primary_card_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261007201000_primary_card_signed_inbox_worker.sql
\ir ../../../../../supabase/migrations/20261007201100_primary_card_intake_role.sql
\ir ../../../../../supabase/migrations/20261008090100_primary_card_signed_inbox_deferred_retry.sql
\ir ../../../../../supabase/migrations/20261008092000_primary_card_signed_inbox_conflict_block.sql
\ir ../../../../../supabase/migrations/20261008092400_primary_card_custody_settlement_fence.sql
\ir ../../../../../supabase/migrations/20261008091800_primary_card_transfer_outbox_lease.sql
\ir ../../../../../supabase/migrations/20261008092600_primary_card_worker_expiry_drain.sql
CREATE TABLE public.fence_fixture(label text PRIMARY KEY,capability jsonb,envelope jsonb,raw_hex text,claim jsonb);
GRANT SELECT,UPDATE ON public.fence_fixture TO baci_primary_card_custody;
INSERT INTO public.fence_fixture(label,capability,envelope)
SELECT custody.label,
 jsonb_build_object('contractId','fixture-contract','evidenceIssuer','fixture-issuer','treasuryWebhookCustomerId','fixture-business','transactionCustomerId','fixture-business',
 'payloadContract','wallet-transfer-outflow-v1','mappingContract','single-transaction-third-party-reference-v1','merchantId',custody.scope->>'merchantId','businessId','fixture-business','expiresAt','2099-01-01T00:00:00Z'),
 jsonb_build_object('eventId',custody.proof->>'eventId','eventType','wallet-transfer.outflow.success','eventCategory','wallet-transfer','customer_id','fixture-business','pvb_wallet','owner-treasury','pvb_reference','canonical-'||custody.label,'eventData',jsonb_build_object('amount',25000,'currency','NGN'))
FROM public.custody_fixture custody;
UPDATE public.fence_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex');
INSERT INTO public.fence_fixture(label,capability,envelope)
SELECT 'drain-intake-receipt',capability,jsonb_set(envelope,'{eventId}','"drain-intake-receipt"')
FROM public.fence_fixture WHERE label='third@example.test';
UPDATE public.fence_fixture SET raw_hex=encode(convert_to(envelope::text,'UTF8'),'hex') WHERE label='drain-intake-receipt';
INSERT INTO piggyvest_primary_card.inbox_capabilities VALUES('10000000-0000-4000-8000-000000000004','fixture-contract','fixture-issuer','fixture-business','fixture-business','wallet-transfer-outflow-v1','single-transaction-third-party-reference-v1',true);
CREATE ROLE baci_primary_card_intake LOGIN;
GRANT primary_card_signed_intake TO baci_primary_card_intake;
GRANT SELECT ON public.fence_fixture TO baci_primary_card_intake;
GRANT SELECT,UPDATE ON public.fence_fixture TO baci_primary_card_transfer;
INSERT INTO piggyvest_primary_card.intake_authority VALUES('10000000-0000-4000-8000-000000000004','baci_primary_card_intake','2099-01-01',true);

-- Ledger-only change under test: card funding settles into the PiggyVest
-- receipt ledger and never touches the legacy wallet.
-- The checkout-reversal table (a later migration) exists in production; the
-- settlement function references it, so the fixture carries an empty one.
CREATE TABLE piggyvest_primary_card.checkout_reversals(operation_id uuid,resolution text);
\ir ../../../../../supabase/migrations/20261103025419_piggyvest_deposits_ledger_only.sql
CREATE TABLE public.before_state AS
  SELECT (SELECT coalesce(sum(available_balance),0) FROM public.customer_wallets) AS balance,
         (SELECT count(*) FROM public.customer_wallet_transactions) AS transactions,
         (SELECT count(*) FROM piggyvest_primary.inflow_receipts) AS receipts;
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE
  inbox record;
  proof jsonb;
  claim jsonb;
  digest text;
BEGIN
  SELECT * INTO inbox FROM public.fence_fixture WHERE label='third@example.test';
  IF piggyvest_primary_card.enqueue_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,inbox.raw_hex,repeat('a',128))<>'accepted' THEN RAISE EXCEPTION 'ledger-only intake failed'; END IF;
  claim := piggyvest_primary_card.claim_signed_inbox('10000000-0000-4000-8000-000000000004','staging',inbox.capability,2)->0;
  digest := encode(sha256(decode(inbox.raw_hex,'hex')),'hex');
  proof := (SELECT custody.proof FROM public.custody_fixture custody WHERE label='third@example.test')
    ||jsonb_build_object('observedAt',clock_timestamp(),'bodyDigest',digest,'inboxToken',claim->>'token');
  IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'completed' THEN RAISE EXCEPTION 'ledger-only settle failed'; END IF;
  IF piggyvest_primary_card.settle_custody('10000000-0000-4000-8000-000000000004','staging',proof)<>'duplicate' THEN RAISE EXCEPTION 'ledger-only replay not duplicate'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT coalesce(sum(available_balance),0) FROM public.customer_wallets) IS DISTINCT FROM (SELECT balance FROM public.before_state) THEN RAISE EXCEPTION 'card funding changed the legacy wallet balance'; END IF;
  IF (SELECT count(*) FROM public.customer_wallet_transactions) IS DISTINCT FROM (SELECT transactions FROM public.before_state) THEN RAISE EXCEPTION 'card funding wrote a legacy wallet transaction'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts) <> (SELECT receipts FROM public.before_state) + 1 THEN RAISE EXCEPTION 'card funding receipt not recorded exactly once'; END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.inflow_receipts receipt JOIN piggyvest_primary_card.settlements settlement ON settlement.receipt_id=receipt.id WHERE receipt.wallet_transaction_id IS NULL) THEN RAISE EXCEPTION 'settlement not tied to a ledger-only receipt'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.settlements) <> 1 THEN RAISE EXCEPTION 'unexpected settlement count'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.custody_fixture WHERE label='third@example.test')) <> 'completed' THEN RAISE EXCEPTION 'custody operation not completed'; END IF;
END $$;
