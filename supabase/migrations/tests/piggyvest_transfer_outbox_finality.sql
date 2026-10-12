DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role)
      AND (
        has_function_privilege(
          restricted_role,
          'public.require_piggyvest_transfer_outbox_worker()',
          'EXECUTE'
        )
        OR has_function_privilege(
          restricted_role,
          'public.require_piggyvest_transfer_outbox_system(text)',
          'EXECUTE'
        )
        OR has_function_privilege(
          restricted_role,
          'public.protect_piggyvest_scoped_transfer_outbox()',
          'EXECUTE'
        )
        OR has_function_privilege(
          restricted_role,
          'public.read_piggyvest_transfer_outbox_finality(text, text, text, text, text)',
          'EXECUTE'
        )
        OR has_function_privilege(
          restricted_role,
          'public.apply_piggyvest_transfer_outbox_finality(text, text, bigint, text, text, text, text, text, text, text, text, text)',
          'EXECUTE'
        )
      ) THEN
      RAISE EXCEPTION 'restricted role % retained finality execute privilege', restricted_role;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  identity_values record;
BEGIN
  FOR identity_values IN
    SELECT *
    FROM (
      VALUES
        ('currency', NULL::text, 'source-wallet-001', 'provider-customer-001', 'business-001', 'integration-001'),
        ('source_wallet_id', 'NGN', NULL::text, 'provider-customer-001', 'business-001', 'integration-001'),
        ('provider_customer_id', 'NGN', 'source-wallet-001', NULL::text, 'business-001', 'integration-001'),
        ('business_id', 'NGN', 'source-wallet-001', 'provider-customer-001', NULL::text, 'integration-001'),
        ('integration_id', 'NGN', 'source-wallet-001', 'provider-customer-001', 'business-001', NULL::text)
    ) AS values_to_reject(
      identity_name,
      currency,
      source_wallet_id,
      provider_customer_id,
      business_id,
      integration_id
    )
  LOOP
    BEGIN
      INSERT INTO public.piggyvest_transfer_outbox (
        reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
        destination_ref, currency, source_wallet_id, provider_customer_id,
        business_id, integration_id
      ) VALUES (
        'finality-owner-partial-' || identity_values.identity_name,
        'c0065070-dc32-45d2-9c01-871a27abfd10',
        '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
        'bank', '058:6789', identity_values.currency,
        identity_values.source_wallet_id, identity_values.provider_customer_id,
        identity_values.business_id, identity_values.integration_id
      );
      RAISE EXCEPTION 'partial finality identity % was accepted', identity_values.identity_name;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;
END;
$$;

BEGIN;

INSERT INTO public.piggyvest_transfer_outbox (
  reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
  destination_ref, currency, source_wallet_id, provider_customer_id,
  business_id, integration_id
) VALUES (
  'finality-race-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
  '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
  'bank', '058:6789', 'NGN', 'source-wallet-001', 'provider-customer-001',
  'business-001', 'integration-001'
);

SET LOCAL SESSION AUTHORIZATION piggyvest_staging_ledger_worker;

DO $$
DECLARE
  outcome text;
BEGIN
  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'applied' THEN
    RAISE EXCEPTION 'expected applied, got %', outcome;
  END IF;

  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'duplicate' THEN
    RAISE EXCEPTION 'expected duplicate, got %', outcome;
  END IF;

  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-foreign', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'terminal-conflict' THEN
    RAISE EXCEPTION 'same terminal state with foreign provider identity must conflict, got %', outcome;
  END IF;

  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-race-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'failed'
  ) INTO outcome;
  IF outcome <> 'terminal-conflict' THEN
    RAISE EXCEPTION 'expected terminal-conflict, got %', outcome;
  END IF;

  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-race-001', 500001, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'failed'
  ) INTO outcome;
  IF outcome <> 'not-submitted' THEN
    RAISE EXCEPTION 'identity mismatch must be not-submitted, got %', outcome;
  END IF;

END;
$$;

ROLLBACK;

BEGIN;

INSERT INTO public.piggyvest_transfer_outbox (
  reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
  destination_ref, currency, source_wallet_id, provider_customer_id,
  business_id, integration_id
) VALUES (
  'finality-trigger-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
  '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
  'bank', '058:6789', 'NGN', 'source-wallet-001', 'provider-customer-001',
  'business-001', 'integration-001'
), (
  'finality-unique-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
  '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
  'bank', '058:6789', 'NGN', 'source-wallet-001', 'provider-customer-001',
  'business-001', 'integration-001'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.piggyvest_transfer_outbox
    SET status = 'failed'
    WHERE reference = 'finality-trigger-001';
    RAISE EXCEPTION 'direct scoped-row mutation was not refused';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'scoped PiggyVest transfer outbox terminal mutation refused' THEN
      RAISE;
    END IF;
  END;
END;
$$;

SET LOCAL SESSION AUTHORIZATION piggyvest_staging_ledger_worker;

DO $$
DECLARE
  outcome text;
BEGIN
  SELECT public.apply_piggyvest_transfer_outbox_finality(
    (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
    'finality-trigger-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
    'bank', 'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-001', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'applied' THEN
    RAISE EXCEPTION 'expected unique seed applied, got %', outcome;
  END IF;

  BEGIN
    PERFORM public.apply_piggyvest_transfer_outbox_finality(
      (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
      'finality-unique-001', 500000, 'NGN', 'source-wallet-001', '058:6789',
      'bank', 'provider-customer-001', 'business-001', 'integration-001',
      'provider-transaction-001', 'succeeded'
    );
    RAISE EXCEPTION 'provider transaction identity was reused';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL SESSION AUTHORIZATION piggyvest_staging_ledger_worker;

DO $$
BEGIN
  BEGIN
    PERFORM public.read_piggyvest_transfer_outbox_finality(
      (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
      'finality-race-001', 'provider-customer-001', 'business-001',
      'integration-001'
    );
    RAISE EXCEPTION 'repeatable-read finality call was not refused';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'piggyvest transfer outbox finality requires read committed' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
