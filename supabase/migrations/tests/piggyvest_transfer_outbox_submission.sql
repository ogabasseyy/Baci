DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'piggyvest_staging_ledger_worker'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role)
      AND (
        has_function_privilege(restricted_role, 'public.claim_piggyvest_transfer_outbox_submission(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text)', 'EXECUTE')
        OR has_function_privilege(restricted_role, 'public.recover_piggyvest_transfer_outbox_submission_unknown(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, text)', 'EXECUTE')
      ) THEN
      RAISE EXCEPTION 'restricted role % retained submission execute privilege', restricted_role;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT has_function_privilege(
    'piggyvest_staging_submission_writer',
    'public.claim_piggyvest_transfer_outbox_submission(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'submission writer lacks claim privilege';
  END IF;
  IF has_function_privilege(
    'piggyvest_staging_submission_writer',
    'public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'submission writer retained direct finality privilege';
  END IF;
  IF has_table_privilege(
    'piggyvest_staging_submission_writer',
    'public.piggyvest_transfer_outbox',
    'INSERT, UPDATE'
  ) THEN
    RAISE EXCEPTION 'submission writer retained direct outbox mutation privilege';
  END IF;
END;
$$;

BEGIN;

INSERT INTO public.piggyvest_transfer_submission_authorizations (
  id, reference, customer_id, merchant_id, wallet_id, amount_kobo, currency,
  source_wallet_id, destination_ref, direction, provider_customer_id,
  business_id, integration_id, expires_at
) VALUES (
  'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
  'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
  'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
  'provider-customer-001', 'business-001', 'integration-001', now() + interval '1 day'
);

SET LOCAL SESSION AUTHORIZATION piggyvest_staging_submission_writer;

DO $$
DECLARE
  system_id text := (SELECT system_identifier::text FROM pg_catalog.pg_control_system());
  outcome text;
BEGIN
  SELECT public.claim_piggyvest_transfer_outbox_submission(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'claimed' THEN RAISE EXCEPTION 'expected authorized claim, got %', outcome; END IF;

  SELECT public.claim_piggyvest_transfer_outbox_submission(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-foreign', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'authorization-refused' THEN RAISE EXCEPTION 'caller identity self-attested, got %', outcome; END IF;

  SELECT public.mark_piggyvest_transfer_outbox_submission_unknown(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'outcome-unknown' THEN RAISE EXCEPTION 'expected unknown claim, got %', outcome; END IF;

  SELECT public.claim_piggyvest_transfer_outbox_submission(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'outcome-unknown' THEN RAISE EXCEPTION 'unknown outcome allowed a resend, got %', outcome; END IF;

  SELECT public.recover_piggyvest_transfer_outbox_submission_unknown(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'applied' THEN RAISE EXCEPTION 'expected terminal recovery, got %', outcome; END IF;

  SELECT public.recover_piggyvest_transfer_outbox_submission_unknown(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd10', 'submission-sql-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'duplicate' THEN RAISE EXCEPTION 'expected duplicate recovery, got %', outcome; END IF;
END;
$$;

RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_outbox
    WHERE reference = 'submission-sql-001'
      AND status = 'succeeded'
      AND provider_transaction_id = 'provider-transaction-001'
  ) THEN RAISE EXCEPTION 'terminal recovery did not durably finalize outbox'; END IF;
END;
$$;

ROLLBACK;
