BEGIN;

INSERT INTO public.piggyvest_transfer_submission_authorizations (
  id, reference, customer_id, merchant_id, wallet_id, amount_kobo, currency,
  source_wallet_id, destination_ref, direction, provider_customer_id,
  business_id, integration_id, expires_at
) VALUES
  (
    'a0065070-dc32-45d2-9c01-871a27abfd20', 'claimed-crash-recovery-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() + interval '1 day'
  ),
  (
    'a0065070-dc32-45d2-9c01-871a27abfd21', 'claimed-wrong-owner-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() + interval '1 day'
  ),
  (
    'a0065070-dc32-45d2-9c01-871a27abfd22', 'consumed-authority-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() + interval '1 day'
  ),
  (
    'a0065070-dc32-45d2-9c01-871a27abfd23', 'revoked-authority-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() + interval '1 day'
  ),
  (
    'a0065070-dc32-45d2-9c01-871a27abfd24', 'expired-authority-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() - interval '1 second'
  );

UPDATE public.piggyvest_transfer_submission_authorizations
SET state = 'consumed'
WHERE reference = 'consumed-authority-001';

UPDATE public.piggyvest_transfer_submission_authorizations
SET state = 'revoked'
WHERE reference = 'revoked-authority-001';

INSERT INTO public.piggyvest_transfer_submission_authorizations (
  id, reference, customer_id, merchant_id, wallet_id, amount_kobo, currency,
  source_wallet_id, destination_ref, direction, provider_customer_id,
  business_id, integration_id, expires_at
) VALUES (
  'a0065070-dc32-45d2-9c01-871a27abfd25', 'expiry-between-gates-001',
  'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
  'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
  'provider-customer-001', 'business-001', 'integration-001', clock_timestamp() + interval '1 day'
);

CREATE FUNCTION public.expire_submission_authorization_after_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.reference = 'expiry-between-gates-001' THEN
    UPDATE public.piggyvest_transfer_submission_authorizations
    SET expires_at = clock_timestamp() - interval '1 second'
    WHERE id = NEW.authorization_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expire_submission_authorization_after_claim
AFTER INSERT ON public.piggyvest_transfer_outbox_submission_claims
FOR EACH ROW
EXECUTE FUNCTION public.expire_submission_authorization_after_claim();

INSERT INTO public.piggyvest_transfer_outbox (
  reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
  destination_ref, status, currency, source_wallet_id, provider_customer_id,
  business_id, integration_id
) VALUES (
  'claimed-wrong-owner-001',
  'd0065070-dc32-45d2-9c01-871a27abfd10',
  '53e157b6-179c-432a-9392-e0827da96d82',
  'foreign-wallet-001',
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

SET LOCAL SESSION AUTHORIZATION piggyvest_staging_submission_writer;

DO $$
DECLARE
  system_id text := (SELECT system_identifier::text FROM pg_catalog.pg_control_system());
  outcome text;
BEGIN
  SELECT public.claim_piggyvest_transfer_outbox_submission(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd20', 'claimed-crash-recovery-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'claimed' THEN RAISE EXCEPTION 'expected crash-window claim, got %', outcome; END IF;

  SELECT public.recover_piggyvest_transfer_outbox_submission_unknown(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd20', 'claimed-crash-recovery-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-020', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'applied' THEN RAISE EXCEPTION 'claimed crash recovery wedged, got %', outcome; END IF;

  SELECT public.claim_piggyvest_transfer_outbox_submission(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd21', 'claimed-wrong-owner-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001'
  ) INTO outcome;
  IF outcome <> 'claimed' THEN RAISE EXCEPTION 'expected wrong-owner claim, got %', outcome; END IF;

  SELECT public.recover_piggyvest_transfer_outbox_submission_unknown(
    system_id, 'a0065070-dc32-45d2-9c01-871a27abfd21', 'claimed-wrong-owner-001',
    'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
    'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
    'provider-customer-001', 'business-001', 'integration-001',
    'provider-transaction-021', 'succeeded'
  ) INTO outcome;
  IF outcome <> 'identity-conflict' THEN RAISE EXCEPTION 'wrong internal owner finalized, got %', outcome; END IF;

  BEGIN
    PERFORM public.claim_piggyvest_transfer_outbox_submission(
      system_id, 'a0065070-dc32-45d2-9c01-871a27abfd25', 'expiry-between-gates-001',
      'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
      'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
      'provider-customer-001', 'business-001', 'integration-001'
    );
    RAISE EXCEPTION 'expired-between-gates claim returned instead of rolling back';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'piggyvest transfer submission authorization expired before claim' THEN
      RAISE;
    END IF;
  END;

  FOREACH outcome IN ARRAY ARRAY['consumed-authority-001', 'revoked-authority-001', 'expired-authority-001'] LOOP
    SELECT public.claim_piggyvest_transfer_outbox_submission(
      system_id,
      CASE outcome
        WHEN 'consumed-authority-001' THEN 'a0065070-dc32-45d2-9c01-871a27abfd22'::uuid
        WHEN 'revoked-authority-001' THEN 'a0065070-dc32-45d2-9c01-871a27abfd23'::uuid
        ELSE 'a0065070-dc32-45d2-9c01-871a27abfd24'::uuid
      END,
      outcome,
      'c0065070-dc32-45d2-9c01-871a27abfd10', '43e157b6-179c-432a-9392-e0827da96d82',
      'ledger-wallet-001', 500000, 'NGN', 'source-wallet-001', '058:6789', 'bank',
      'provider-customer-001', 'business-001', 'integration-001'
    ) INTO outcome;
    IF outcome <> 'authorization-refused' THEN RAISE EXCEPTION 'unavailable authority created a claim, got %', outcome; END IF;
  END LOOP;
END;
$$;

RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.piggyvest_transfer_submission_authorizations AS auth
    JOIN public.piggyvest_transfer_outbox_submission_claims AS claim
      ON claim.authorization_id = auth.id
    WHERE auth.id = 'a0065070-dc32-45d2-9c01-871a27abfd20'::uuid
      AND auth.state = 'consumed'
      AND claim.state = 'finalized'
  ) THEN RAISE EXCEPTION 'claimed crash recovery did not finalize authorization'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_outbox_submission_claims
    WHERE reference IN (
      'consumed-authority-001',
      'revoked-authority-001',
      'expired-authority-001'
    )
  ) THEN RAISE EXCEPTION 'unavailable authority created a durable claim'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_outbox_submission_claims
    WHERE reference = 'expiry-between-gates-001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_submission_authorizations
    WHERE id = 'a0065070-dc32-45d2-9c01-871a27abfd25'::uuid
      AND state = 'authorized'
      AND expires_at > clock_timestamp()
  ) THEN RAISE EXCEPTION 'expired-between-gates claim left durable state'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_outbox
    WHERE reference = 'claimed-wrong-owner-001'
      AND (
        customer_id <> 'd0065070-dc32-45d2-9c01-871a27abfd10'::uuid
        OR merchant_id <> '53e157b6-179c-432a-9392-e0827da96d82'::uuid
        OR wallet_id <> 'foreign-wallet-001'
        OR status <> 'submitted'
        OR provider_transaction_id IS NOT NULL
      )
  ) THEN RAISE EXCEPTION 'wrong-owner outbox changed before CAS refusal'; END IF;
END;
$$;

ROLLBACK;
