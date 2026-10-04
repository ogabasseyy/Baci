ALTER TABLE public.piggyvest_transfer_submission_authorizations
  DROP CONSTRAINT IF EXISTS piggyvest_transfer_submission_authorizations_state_check;

ALTER TABLE public.piggyvest_transfer_submission_authorizations
  ADD CONSTRAINT piggyvest_transfer_submission_authorizations_state_check
  CHECK (state IN ('authorized', 'claimed', 'consumed', 'revoked'));

CREATE OR REPLACE FUNCTION public.claim_piggyvest_transfer_outbox_submission(
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
  p_integration_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authorization_state text;
  authorization_expires_at timestamptz;
  claim_state text;
BEGIN
  PERFORM public.require_piggyvest_transfer_submission_worker(
    p_expected_system_identifier
  );

  SELECT auth.state, auth.expires_at
  INTO authorization_state, authorization_expires_at
  FROM public.piggyvest_transfer_submission_authorizations AS auth
  WHERE auth.id = p_authorization_id
    AND auth.reference = p_reference
    AND auth.customer_id = p_customer_id
    AND auth.merchant_id = p_merchant_id
    AND auth.wallet_id = p_wallet_id
    AND auth.amount_kobo = p_amount_kobo
    AND auth.currency = p_currency
    AND auth.source_wallet_id = p_source_wallet_id
    AND auth.destination_ref = p_destination_ref
    AND auth.direction = p_direction
    AND auth.provider_customer_id = p_provider_customer_id
    AND auth.business_id = p_business_id
    AND auth.integration_id = p_integration_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'authorization-refused'; END IF;

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
    AND claims.integration_id = p_integration_id;

  IF FOUND THEN
    IF claim_state = 'claimed' THEN RETURN 'already-claimed'; END IF;
    IF claim_state = 'submitted' THEN RETURN 'already-submitted'; END IF;
    RETURN 'outcome-unknown';
  END IF;

  IF authorization_state <> 'authorized'
    OR authorization_expires_at <= clock_timestamp() THEN
    RETURN 'authorization-refused';
  END IF;

  INSERT INTO public.piggyvest_transfer_outbox_submission_claims (
    reference, authorization_id, customer_id, merchant_id, wallet_id,
    amount_kobo, currency, source_wallet_id, destination_ref, direction,
    provider_customer_id, business_id, integration_id
  ) VALUES (
    p_reference, p_authorization_id, p_customer_id, p_merchant_id, p_wallet_id,
    p_amount_kobo, p_currency, p_source_wallet_id, p_destination_ref, p_direction,
    p_provider_customer_id, p_business_id, p_integration_id
  ) ON CONFLICT (reference) DO NOTHING
  RETURNING state INTO claim_state;

  IF FOUND THEN
    UPDATE public.piggyvest_transfer_submission_authorizations
    SET state = 'claimed', updated_at = now()
    WHERE id = p_authorization_id
      AND state = 'authorized'
      AND expires_at > clock_timestamp();
    IF FOUND THEN RETURN 'claimed'; END IF;
    RAISE EXCEPTION 'piggyvest transfer submission authorization expired before claim';
  END IF;

  RETURN 'identity-conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_piggyvest_transfer_outbox_submission(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text) FROM PUBLIC;

DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'piggyvest_staging_ledger_worker', 'piggyvest_staging_submission_writer'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.claim_piggyvest_transfer_outbox_submission(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text) FROM %I', restricted_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_submission_writer') THEN
    GRANT EXECUTE ON FUNCTION public.claim_piggyvest_transfer_outbox_submission(text, uuid, text, uuid, uuid, text, bigint, text, text, text, text, text, text, text) TO piggyvest_staging_submission_writer;
  END IF;
END;
$$;
