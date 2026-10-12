CREATE OR REPLACE FUNCTION public.recognize_piggyvest_staging_inflow(
  p_provider_transaction_id text, p_event_data_id text, p_event_id text,
  p_provider_customer_id text, p_wallet_id text, p_amount_kobo bigint,
  p_fee_kobo bigint, p_reference text, p_session_id text, p_credited_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  existing_credit public.piggyvest_inflow_credits%ROWTYPE;
BEGIN
  IF p_provider_transaction_id IS NULL OR btrim(p_provider_transaction_id) = ''
    OR p_event_data_id IS NULL OR btrim(p_event_data_id) = ''
    OR p_event_id IS NULL OR btrim(p_event_id) = ''
    OR p_provider_customer_id IS NULL OR btrim(p_provider_customer_id) = ''
    OR p_wallet_id IS NULL OR btrim(p_wallet_id) = ''
    OR p_amount_kobo IS NULL OR p_amount_kobo <= 0
    OR p_fee_kobo IS NULL OR p_fee_kobo < 0
    OR p_reference IS NULL OR btrim(p_reference) = ''
    OR (p_session_id IS NOT NULL AND btrim(p_session_id) = '')
    OR p_credited_at IS NULL THEN
    RAISE EXCEPTION 'Invalid inflow recognition input' USING ERRCODE = '22023';
  END IF;
  SELECT amount_kobo, wallet_id, customer_id INTO existing_credit.amount_kobo, existing_credit.wallet_id, existing_credit.customer_id FROM public.piggyvest_inflow_credits
  WHERE provider_transaction_id = p_provider_transaction_id;
  IF FOUND THEN
    IF existing_credit.amount_kobo <> p_amount_kobo
      OR existing_credit.wallet_id <> p_wallet_id
      OR existing_credit.customer_id <> p_provider_customer_id THEN
      RAISE EXCEPTION 'Conflicting duplicate provider inflow' USING ERRCODE = '23505';
    END IF;
    RETURN 'duplicate';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_plan_wallets AS mapping
    WHERE mapping.piggyvest_customer_id = p_provider_customer_id
      AND mapping.wallet_id = p_wallet_id
  ) THEN
    RAISE EXCEPTION 'No exact plan-wallet mapping for inflow' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.piggyvest_inflow_credits (
    provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
    amount_kobo, fee_kobo, reference, session_id, credited_at
  ) VALUES (
    p_provider_transaction_id, p_event_data_id, p_event_id, p_provider_customer_id,
    p_wallet_id, p_amount_kobo, p_fee_kobo, p_reference, p_session_id, p_credited_at
  ) ON CONFLICT (provider_transaction_id) DO NOTHING;
  IF FOUND THEN RETURN 'recognized'; END IF;
  SELECT amount_kobo, wallet_id, customer_id INTO existing_credit.amount_kobo, existing_credit.wallet_id, existing_credit.customer_id FROM public.piggyvest_inflow_credits
  WHERE provider_transaction_id = p_provider_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inflow recognition conflict was not readable' USING ERRCODE = '40001';
  END IF;
  IF existing_credit.amount_kobo <> p_amount_kobo
    OR existing_credit.wallet_id <> p_wallet_id
    OR existing_credit.customer_id <> p_provider_customer_id THEN
    RAISE EXCEPTION 'Conflicting duplicate provider inflow' USING ERRCODE = '23505';
  END IF;
  RETURN 'duplicate';
END
$function$;

CREATE OR REPLACE FUNCTION public.piggyvest_staging_system_id()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
  SELECT system_identifier::text FROM pg_control_system()
$function$;

REVOKE ALL ON TABLE public.piggyvest_plan_wallets, public.piggyvest_inflow_credits
  FROM PUBLIC, anon, authenticated, pvb_staging_app_worker;
REVOKE ALL ON FUNCTION public.recognize_piggyvest_staging_inflow(
  text, text, text, text, text, bigint, bigint, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.piggyvest_staging_system_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (customer_id, merchant_id, piggyvest_customer_id, wallet_id)
  ON public.piggyvest_plan_wallets TO pvb_staging_app_worker;
DO $mapping_policy$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'piggyvest_plan_wallets'
      AND policyname = 'pvb_staging_app_worker_mapping_read'
  ) THEN
    DROP POLICY pvb_staging_app_worker_mapping_read ON public.piggyvest_plan_wallets;
  END IF;
END
$mapping_policy$;
CREATE POLICY pvb_staging_app_worker_mapping_read ON public.piggyvest_plan_wallets
  FOR SELECT TO pvb_staging_app_worker USING (true);
GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(
  text, text, text, text, text, bigint, bigint, text, text, timestamptz
) TO pvb_staging_app_worker;
GRANT EXECUTE ON FUNCTION public.piggyvest_staging_system_id()
  TO pvb_staging_app_worker;
