CREATE OR REPLACE FUNCTION public.read_piggyvest_transfer_outbox_finality_scoped(
  p_expected_system_identifier text,
  p_reference text,
  p_provider_customer_id text,
  p_business_id text,
  p_integration_id text
)
RETURNS TABLE (
  customer_id uuid,
  reference text,
  amount_kobo bigint,
  currency text,
  source_wallet_id text,
  destination_ref text,
  direction text,
  provider_customer_id text,
  business_id text,
  integration_id text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_piggyvest_transfer_outbox_worker();
  PERFORM public.require_piggyvest_transfer_outbox_system(
    p_expected_system_identifier
  );

  RETURN QUERY
  SELECT
    outbox.customer_id,
    outbox.reference,
    outbox.amount_kobo,
    outbox.currency,
    outbox.source_wallet_id,
    outbox.destination_ref,
    outbox.direction,
    outbox.provider_customer_id,
    outbox.business_id,
    outbox.integration_id,
    outbox.status
  FROM public.piggyvest_transfer_outbox AS outbox
  WHERE outbox.reference = p_reference
    AND outbox.provider_customer_id = p_provider_customer_id
    AND outbox.business_id = p_business_id
    AND outbox.integration_id = p_integration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.read_piggyvest_transfer_outbox_finality_scoped(text, text, text, text, text) FROM PUBLIC;

DO $$
DECLARE
  restricted_role text;
BEGIN
  FOREACH restricted_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'piggyvest_staging_submission_writer'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = restricted_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.read_piggyvest_transfer_outbox_finality_scoped(text, text, text, text, text) FROM %I',
        restricted_role
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_ledger_worker') THEN
    GRANT EXECUTE ON FUNCTION public.read_piggyvest_transfer_outbox_finality_scoped(text, text, text, text, text)
      TO piggyvest_staging_ledger_worker;
  END IF;
END;
$$;
