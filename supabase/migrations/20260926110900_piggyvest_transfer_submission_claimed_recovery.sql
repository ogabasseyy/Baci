CREATE OR REPLACE FUNCTION public.recover_piggyvest_transfer_outbox_submission_unknown(
  p_expected_system_identifier text,
  p_authorization_id uuid,
  p_reference text,
  p_customer_id uuid,
  p_merchant_id uuid,
  p_wallet_id text,
  p_amount_kobo bigint,
  p_currency text,
  p_source_wallet_id text,
  p_destination_ref text,
  p_direction text,
  p_provider_customer_id text,
  p_business_id text,
  p_integration_id text,
  p_provider_transaction_id text,
  p_terminal_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claim_state text;
  terminal_outcome text;
BEGIN
  PERFORM public.require_piggyvest_transfer_submission_worker(
    p_expected_system_identifier
  );
  IF p_terminal_status NOT IN ('succeeded', 'failed')
    OR p_provider_transaction_id IS NULL
    OR length(btrim(p_provider_transaction_id)) = 0 THEN
    RETURN 'identity-conflict';
  END IF;

  SELECT claims.state INTO claim_state
  FROM public.piggyvest_transfer_outbox_submission_claims AS claims
  WHERE claims.reference = p_reference
    AND claims.authorization_id = p_authorization_id
    AND claims.customer_id = p_customer_id
    AND claims.merchant_id = p_merchant_id
    AND claims.wallet_id = p_wallet_id
    AND claims.amount_kobo = p_amount_kobo
    AND claims.currency = p_currency
    AND claims.source_wallet_id = p_source_wallet_id
    AND claims.destination_ref = p_destination_ref
    AND claims.direction = p_direction
    AND claims.provider_customer_id = p_provider_customer_id
    AND claims.business_id = p_business_id
    AND claims.integration_id = p_integration_id
  FOR UPDATE;
  IF NOT FOUND OR claim_state NOT IN ('claimed', 'outcome_unknown', 'finalized') THEN
    RETURN 'not-recoverable';
  END IF;

  INSERT INTO public.piggyvest_transfer_outbox (
    reference, customer_id, merchant_id, wallet_id, amount_kobo, direction,
    destination_ref, status, currency, source_wallet_id, provider_customer_id,
    business_id, integration_id
  ) VALUES (
    p_reference, p_customer_id, p_merchant_id, p_wallet_id, p_amount_kobo,
    p_direction, p_destination_ref, 'submitted', p_currency, p_source_wallet_id,
    p_provider_customer_id, p_business_id, p_integration_id
  ) ON CONFLICT (reference) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_transfer_outbox AS outbox
    WHERE outbox.reference = p_reference
      AND outbox.customer_id = p_customer_id
      AND outbox.merchant_id = p_merchant_id
      AND outbox.wallet_id = p_wallet_id
      AND outbox.amount_kobo = p_amount_kobo
      AND outbox.direction = p_direction
      AND outbox.destination_ref = p_destination_ref
      AND outbox.currency = p_currency
      AND outbox.source_wallet_id = p_source_wallet_id
      AND outbox.provider_customer_id = p_provider_customer_id
      AND outbox.business_id = p_business_id
      AND outbox.integration_id = p_integration_id
  ) THEN RETURN 'identity-conflict'; END IF;

  SELECT public.apply_piggyvest_transfer_outbox_finality(
    p_expected_system_identifier, p_reference, p_amount_kobo, p_currency,
    p_source_wallet_id, p_destination_ref, p_direction, p_provider_customer_id,
    p_business_id, p_integration_id, p_provider_transaction_id, p_terminal_status
  ) INTO terminal_outcome;
  IF terminal_outcome IN ('applied', 'duplicate') THEN
    UPDATE public.piggyvest_transfer_outbox_submission_claims
    SET state = 'finalized', updated_at = now()
    WHERE reference = p_reference AND state IN ('claimed', 'outcome_unknown');
    UPDATE public.piggyvest_transfer_submission_authorizations
    SET state = 'consumed', updated_at = now()
    WHERE id = p_authorization_id AND state = 'claimed';
    RETURN terminal_outcome;
  END IF;
  IF terminal_outcome = 'terminal-conflict' THEN RETURN 'terminal-conflict'; END IF;
  RETURN 'identity-conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.recover_piggyvest_transfer_outbox_submission_unknown(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, text) FROM PUBLIC;

DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'piggyvest_staging_ledger_worker', 'piggyvest_staging_submission_writer'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.recover_piggyvest_transfer_outbox_submission_unknown(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, text) FROM %I', restricted_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_submission_writer') THEN
    GRANT EXECUTE ON FUNCTION public.recover_piggyvest_transfer_outbox_submission_unknown(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text, text, text) TO piggyvest_staging_submission_writer;
  END IF;
END;
$$;
