DO $$
BEGIN
  IF session_user <> 'service_role' THEN
    RAISE EXCEPTION 'run this regression as the service_role login';
  END IF;
END;
$$;

BEGIN;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.piggyvest_transfer_outbox (
      reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
      destination_ref, currency, source_wallet_id, provider_customer_id,
      business_id, integration_id
    ) VALUES (
      'finality-service-scoped-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
      '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
      'bank', '058:6789', 'NGN', 'source-wallet-001', 'provider-customer-001',
      'business-001', 'integration-001'
    );
    RAISE EXCEPTION 'service role inserted a scoped finality row';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'scoped PiggyVest transfer outbox rows require the restricted worker or table owner' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO public.piggyvest_transfer_outbox (
    reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
    destination_ref
  ) VALUES (
    'finality-service-legacy-001', 'c0065070-dc32-45d2-9c01-871a27abfd10',
    '43e157b6-179c-432a-9392-e0827da96d82', 'legacy-source-wallet', 500000,
    'bank', '058:6789'
  );

  BEGIN
    UPDATE public.piggyvest_transfer_outbox
    SET currency = 'NGN',
        source_wallet_id = 'source-wallet-001',
        provider_customer_id = 'provider-customer-001',
        business_id = 'business-001',
        integration_id = 'integration-001'
    WHERE reference = 'finality-service-legacy-001';
    RAISE EXCEPTION 'service role upgraded a legacy row to scoped finality';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'scoped PiggyVest transfer outbox rows require the restricted worker or table owner' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
