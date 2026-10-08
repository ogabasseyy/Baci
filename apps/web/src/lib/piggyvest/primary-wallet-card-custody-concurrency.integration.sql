\set ON_ERROR_STOP on
\if :{?assert_race}
DO $$ BEGIN
 IF (SELECT count(*) FROM public.customer_wallet_transactions)<>2 OR (SELECT count(*) FROM piggyvest_primary.inflow_receipts)<>2 THEN RAISE EXCEPTION 'concurrent aliases duplicated credit'; END IF;
 IF (SELECT count(*) FROM piggyvest_primary_card.settlements)<>1 OR (SELECT count(*) FROM piggyvest_primary_card.completion_outbox)<>1 THEN RAISE EXCEPTION 'concurrent custody not settled exactly once'; END IF;
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>35000 OR (SELECT consumed_kobo FROM prefunded_card.treasury_bindings)<>45000 THEN RAISE EXCEPTION 'concurrent custody duplicated treasury consumption'; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_wallets WHERE available_balance<>292 OR total_earned<>7) THEN RAISE EXCEPTION 'concurrent balance incorrect'; END IF;
END $$;
\else
\if :{?bank_race}
SET SESSION AUTHORIZATION fixture_bank_inflow;
SELECT piggyvest_primary.apply_inflow_environment((scope->>'integrationId')::uuid,'staging',jsonb_set(bank,'{providerTransactionId}',to_jsonb(:'alias_prefix'||label))) FROM public.custody_fixture WHERE label='third@example.test';
RESET SESSION AUTHORIZATION;
\else
SET SESSION AUTHORIZATION baci_primary_card_custody;
SELECT piggyvest_primary_card.settle_custody((scope->>'integrationId')::uuid,'staging',proof||jsonb_build_object('observedAt',clock_timestamp())) FROM public.custody_fixture WHERE label='third@example.test';
RESET SESSION AUTHORIZATION;
\endif
\endif
