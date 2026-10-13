BEGIN;
CREATE FUNCTION prefunded_card.apply_verified_legacy_inflow(
  p_provider_transaction_id text,p_event_data_id text,p_event_id text,p_provider_customer_id text,p_wallet_id text,
  p_amount_kobo bigint,p_fee_kobo bigint,p_reference text,p_session_id text,p_credited_at timestamptz
) RETURNS text LANGUAGE plpgsql CALLED ON NULL INPUT SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE integration uuid; receipt prefunded_card.provider_evidence%ROWTYPE; outcome text; system_id text;
DECLARE legacy_duplicate boolean:=false;
BEGIN
  system_id:=(SELECT system_identifier::text FROM pg_control_system());
  IF (SELECT count(*) FROM prefunded_card.evidence_authorities WHERE reader_login=session_user
    AND system_identifier=system_id AND enabled)<>1 THEN
    RAISE EXCEPTION 'bank inflow reader scope refused' USING ERRCODE='42501'; END IF;
  SELECT authority.integration_id INTO STRICT integration FROM prefunded_card.evidence_authorities authority
    WHERE authority.reader_login=session_user AND authority.system_identifier=system_id AND authority.enabled;
  PERFORM prefunded_card.evidence_scope(integration,system_id);
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=integration ORDER BY id FOR UPDATE;
  SELECT * INTO receipt FROM prefunded_card.provider_evidence WHERE integration_id=integration AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR receipt.observation->>'status'<>'verified' THEN RETURN 'deferred'; END IF;
  IF receipt.conflicted THEN RETURN 'reconciliation_required'; END IF;
  IF receipt.observation->>'creditedAt' IS NULL OR receipt.observation->>'eventDataId' IS NULL THEN RETURN 'deferred'; END IF;
  IF receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id THEN
    SELECT EXISTS(
      SELECT 1
      FROM prefunded_card.bank_projections bank
      JOIN piggyvest_savings_ledger.operations canonical
        ON canonical.id=bank.operation_id AND canonical.integration_id=bank.integration_id
          AND canonical.merchant_id=bank.merchant_id AND canonical.customer_id=bank.customer_id
          AND canonical.goal_id=bank.goal_id
      JOIN public.customer_savings_contributions contribution
        ON contribution.id=bank.contribution_id AND contribution.goal_id=bank.goal_id
          AND contribution.merchant_id=bank.merchant_id AND contribution.customer_id=bank.customer_id
      JOIN public.piggyvest_inflow_credits credit
        ON credit.provider_transaction_id=p_provider_transaction_id
      JOIN piggyvest_staging.goal_inflow_projections legacy
        ON legacy.provider_transaction_id=credit.provider_transaction_id
          AND legacy.integration_id=bank.integration_id AND legacy.contribution_id=contribution.id
          AND legacy.merchant_id=bank.merchant_id AND legacy.customer_id=bank.customer_id
          AND legacy.goal_id=bank.goal_id
      WHERE bank.integration_id=integration
        AND bank.provider_transaction_id=receipt.observation->>'providerTransactionId'
        AND bank.event_id=p_event_id AND bank.amount_kobo=p_amount_kobo
        AND bank.contribution_id=contribution.id
        AND canonical.id=md5('legacy-opening-v1:'||integration::text||':'||p_provider_transaction_id)::uuid
        AND canonical.command->>'kind'='credit_principal'
        AND canonical.command->>'principalKobo'=bank.amount_kobo::text
        AND canonical.command->>'evidenceId'='legacy-opening-v1:'||canonical.id::text
        AND contribution.amount*100=bank.amount_kobo
        AND contribution.source_type='piggyvest_inflow' AND contribution.status='completed'
        AND contribution.idempotency_key='piggyvest:'||p_provider_transaction_id
        AND credit.event_data_id=p_event_data_id AND credit.event_id=p_event_id
        AND credit.customer_id=p_provider_customer_id AND credit.wallet_id=legacy.provider_wallet_id
        AND credit.amount_kobo=p_amount_kobo AND credit.fee_kobo=p_fee_kobo
        AND credit.reference=p_reference AND credit.session_id IS NOT DISTINCT FROM p_session_id
        AND credit.credited_at=p_credited_at
        AND legacy.provider_wallet_id=receipt.observation->>'destinationWalletId'
        AND legacy.provider_customer_id=receipt.observation->>'destinationCustomerId'
        AND legacy.event_data_id=p_event_data_id AND legacy.event_id=p_event_id
        AND legacy.amount_kobo=p_amount_kobo AND legacy.fee_kobo=p_fee_kobo
        AND legacy.reference=p_reference AND legacy.session_id IS NOT DISTINCT FROM p_session_id
        AND legacy.credited_at=p_credited_at
        AND receipt.observation->>'eventId'=p_event_id
        AND (receipt.observation->'references') ? p_provider_transaction_id
        AND (receipt.observation->'references') ? (receipt.observation->>'providerTransactionId')
    ) INTO legacy_duplicate;
    IF NOT legacy_duplicate THEN RETURN 'reconciliation_required'; END IF;
  END IF;
  IF receipt.observation->>'kind'<>'bank_inflow'
    OR receipt.observation->>'eventDataId' IS DISTINCT FROM p_event_data_id
    OR receipt.observation->>'destinationCustomerId' IS DISTINCT FROM p_provider_customer_id
    OR (receipt.observation->>'destinationWalletId' IS DISTINCT FROM p_wallet_id AND receipt.observation->>'envelopeWalletId' IS DISTINCT FROM p_wallet_id)
    OR (receipt.observation->>'amountKobo')::bigint IS DISTINCT FROM p_amount_kobo OR p_fee_kobo IS DISTINCT FROM 0
    OR receipt.observation->>'reference' IS DISTINCT FROM p_reference OR receipt.observation->>'sessionId' IS DISTINCT FROM p_session_id
    OR (receipt.observation->>'creditedAt')::timestamptz IS DISTINCT FROM p_credited_at THEN
    RETURN 'reconciliation_required';
  END IF;
  outcome:=prefunded_card.apply_classified_inflow(integration,system_id,p_event_id);
  RETURN CASE WHEN outcome='applied' THEN 'recognized' ELSE outcome END;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
