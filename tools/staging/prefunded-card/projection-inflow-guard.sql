BEGIN;
ALTER FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  SET SCHEMA prefunded_card;
ALTER FUNCTION prefunded_card.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  RENAME TO legacy_inflow;
REVOKE ALL ON FUNCTION prefunded_card.legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

CREATE FUNCTION public.recognize_piggyvest_staging_inflow(
  p_provider_transaction_id text,p_event_data_id text,p_event_id text,p_provider_customer_id text,p_wallet_id text,
  p_amount_kobo bigint,p_fee_kobo bigint,p_reference text,p_session_id text,p_credited_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE enrolled boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM prefunded_card.credit_routes route
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=route.integration_id
      AND mapping.goal_id=route.goal_id AND mapping.merchant_id=route.merchant_id AND mapping.customer_id=route.customer_id
    WHERE mapping.provider_wallet_id=p_wallet_id) INTO enrolled;
  IF NOT enrolled AND to_regclass('prefunded_card.provider_evidence') IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM prefunded_card.provider_evidence receipt
      JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=receipt.integration_id
        AND mapping.provider_wallet_id=receipt.observation->>'destinationWalletId'
      JOIN prefunded_card.credit_routes route ON route.integration_id=mapping.integration_id AND route.goal_id=mapping.goal_id
        AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id
      WHERE receipt.event_id=p_event_id) INTO enrolled;
  END IF;
  IF enrolled THEN
    IF EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias
      JOIN prefunded_card.operations operation ON operation.id=alias.operation_id AND operation.integration_id=alias.integration_id
      JOIN prefunded_card.projections projection ON projection.operation_id=operation.id
      JOIN prefunded_card.credit_routes route ON route.goal_id=operation.goal_id AND route.integration_id=operation.integration_id
      WHERE alias.provider_transaction_id=p_provider_transaction_id AND operation.transfer_reference=p_reference
        AND operation.destination_wallet_id=p_wallet_id AND operation.destination_customer_id=p_provider_customer_id
        AND operation.amount_kobo=p_amount_kobo AND p_fee_kobo=0
        AND route.system_identifier=(SELECT system_identifier::text FROM pg_control_system())) THEN
      RETURN 'duplicate';
    END IF;
    IF to_regprocedure('prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)') IS NOT NULL THEN
      RETURN prefunded_card.apply_verified_legacy_inflow(p_provider_transaction_id,p_event_data_id,p_event_id,
        p_provider_customer_id,p_wallet_id,p_amount_kobo,p_fee_kobo,p_reference,p_session_id,p_credited_at);
    END IF;
    RAISE EXCEPTION 'enrolled wallet inflow requires canonical correlation' USING ERRCODE='55000';
  END IF;
  RETURN prefunded_card.legacy_inflow(p_provider_transaction_id,p_event_data_id,p_event_id,p_provider_customer_id,p_wallet_id,
    p_amount_kobo,p_fee_kobo,p_reference,p_session_id,p_credited_at);
END $$;
REVOKE ALL ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  TO pvb_staging_app_worker;
COMMIT;
