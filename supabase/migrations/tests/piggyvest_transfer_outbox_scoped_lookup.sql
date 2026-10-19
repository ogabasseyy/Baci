BEGIN;

INSERT INTO public.piggyvest_transfer_outbox (
  reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
  destination_ref, status, currency, source_wallet_id, provider_customer_id,
  business_id, integration_id
) VALUES (
  'scoped-lookup-001',
  'c0065070-dc32-45d2-9c01-871a27abfd10',
  '43e157b6-179c-432a-9392-e0827da96d82',
  'ledger-wallet-001',
  500000,
  'bank',
  '058:6789',
  'submitted',
  'NGN',
  'source-wallet-001',
  'provider-customer-001',
  'business-001',
  'integration-001'
);

SET LOCAL SESSION AUTHORIZATION piggyvest_staging_ledger_worker;

DO $$
DECLARE
  system_id text := (SELECT system_identifier::text FROM pg_catalog.pg_control_system());
  scoped_customer_id uuid;
BEGIN
  SELECT customer_id INTO scoped_customer_id
  FROM public.read_piggyvest_transfer_outbox_finality_scoped(
    system_id,
    'scoped-lookup-001',
    'provider-customer-001',
    'business-001',
    'integration-001'
  );
  IF scoped_customer_id <> 'c0065070-dc32-45d2-9c01-871a27abfd10'::uuid THEN
    RAISE EXCEPTION 'scoped lookup did not return persisted customer identity';
  END IF;
END;
$$;

ROLLBACK;
