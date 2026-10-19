DO $preflight$
DECLARE
  proof jsonb;
  scope jsonb;
  observed text;
  existing boolean;
  expected_count bigint;
  matching_count bigint;
  canonical_principal numeric;
  public_principal numeric;
BEGIN
  SELECT context.proof,context.scope,context.observed INTO STRICT proof,scope,observed
    FROM legacy_enrollment_scope_context context;
  PERFORM 1 FROM piggyvest_staging.integrations registry
    WHERE registry.id=(scope->>'integrationId')::uuid AND registry.enabled
      AND registry.expected_provider_account_id=scope->>'businessId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy enrollment integration refused' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id AND goal.customer_id=mapping.customer_id
      AND goal.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=(scope->>'integrationId')::uuid
      AND mapping.provider_wallet_id=scope->>'providerWalletId'
      AND mapping.provider_customer_id=scope->>'providerCustomerId'
      AND mapping.merchant_id=(scope->>'merchantId')::uuid
      AND mapping.customer_id=(scope->>'customerId')::uuid
      AND mapping.goal_id=(scope->>'goalId')::uuid
      AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active'
      AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL
      AND goal.current_amount=100 AND goal.target_amount=250000 FOR UPDATE OF mapping,customer,goal;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy goal or exact mapping refused' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.evidence_authorities authority
      WHERE authority.integration_id=(scope->>'integrationId')::uuid
        AND (authority.business_id IS DISTINCT FROM scope->>'businessId'
          OR authority.system_identifier IS DISTINCT FROM observed
          OR authority.ingestion_login IS DISTINCT FROM 'prefunded_evidence'
          OR authority.reader_login IS DISTINCT FROM 'prefunded_treasury_operator'
          OR authority.currency IS DISTINCT FROM 'NGN' OR NOT authority.enabled)) THEN
    RAISE EXCEPTION 'existing immutable evidence authority conflicts' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_operator'
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
      AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_evidence'
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
      AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit)
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
      AND NOT rolbypassrls AND NOT rolcanlogin)<>2
    OR (SELECT count(*) FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_roles member ON member.oid=membership.member
      WHERE member.rolname='prefunded_treasury_operator'
        AND granted.rolname IN ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')
        AND NOT membership.admin_option AND NOT membership.inherit_option AND membership.set_option)<>2
    OR EXISTS(SELECT 1 FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_roles member ON member.oid=membership.member
      WHERE (granted.rolname IN ('prefunded_treasury_operator','prefunded_evidence')
        OR member.rolname IN ('prefunded_treasury_operator','prefunded_evidence',
          'prefunded_treasury_ledger_worker','prefunded_card_authorization_reader'))
        AND NOT (member.rolname='prefunded_treasury_operator'
          AND granted.rolname IN ('prefunded_treasury_ledger_worker','prefunded_card_authorization_reader')
          AND NOT membership.admin_option AND NOT membership.inherit_option AND membership.set_option)) THEN
    RAISE EXCEPTION 'restricted session identities refused' USING ERRCODE='42501';
  END IF;

  SELECT count(*), coalesce(sum(contribution.amount*100),0)
    INTO expected_count,public_principal
    FROM public.customer_savings_contributions contribution
    WHERE contribution.goal_id=(scope->>'goalId')::uuid;
  IF expected_count=0 OR EXISTS(SELECT 1 FROM public.customer_savings_contributions contribution
      WHERE contribution.goal_id=(scope->>'goalId')::uuid
        AND (contribution.merchant_id IS DISTINCT FROM (scope->>'merchantId')::uuid
          OR contribution.customer_id IS DISTINCT FROM (scope->>'customerId')::uuid
          OR contribution.source_type IS DISTINCT FROM 'piggyvest_inflow'
          OR contribution.status IS DISTINCT FROM 'completed'
          OR contribution.amount<=0 OR contribution.amount*100<>trunc(contribution.amount*100))) THEN
    RAISE EXCEPTION 'legacy contributions are incomplete or cross-scope' USING ERRCODE='23514';
  END IF;
  IF public_principal IS DISTINCT FROM 10000 OR public_principal IS DISTINCT FROM
      (SELECT current_amount*100 FROM public.customer_savings_goals WHERE id=(scope->>'goalId')::uuid) THEN
    RAISE EXCEPTION 'legacy public principal balance refused' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO matching_count FROM piggyvest_staging.goal_inflow_projections projection
    JOIN public.piggyvest_inflow_credits credit ON credit.provider_transaction_id=projection.provider_transaction_id
    JOIN public.customer_savings_contributions contribution ON contribution.id=projection.contribution_id
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=projection.integration_id
      AND mapping.provider_wallet_id=projection.provider_wallet_id
    WHERE projection.integration_id=(scope->>'integrationId')::uuid
      AND projection.merchant_id=(scope->>'merchantId')::uuid
      AND projection.customer_id=(scope->>'customerId')::uuid
      AND projection.goal_id=(scope->>'goalId')::uuid
      AND projection.provider_wallet_id=scope->>'providerWalletId'
      AND projection.provider_customer_id=scope->>'providerCustomerId'
      AND mapping.goal_id=projection.goal_id AND mapping.merchant_id=projection.merchant_id
      AND mapping.customer_id=projection.customer_id
      AND contribution.goal_id=projection.goal_id AND contribution.merchant_id=projection.merchant_id
      AND contribution.customer_id=projection.customer_id
      AND credit.customer_id=projection.provider_customer_id AND credit.wallet_id=projection.provider_wallet_id
      AND credit.event_data_id=projection.event_data_id AND credit.event_id=projection.event_id
      AND credit.amount_kobo=projection.amount_kobo AND credit.fee_kobo=projection.fee_kobo
      AND credit.reference=projection.reference AND credit.session_id IS NOT DISTINCT FROM projection.session_id
      AND credit.credited_at=projection.credited_at
      AND contribution.amount*100=projection.amount_kobo
      AND contribution.idempotency_key='piggyvest:'||projection.provider_transaction_id
      AND contribution.status='completed' AND contribution.source_type='piggyvest_inflow';
  IF matching_count<>expected_count OR (SELECT count(*) FROM piggyvest_staging.goal_inflow_projections
       WHERE goal_id=(scope->>'goalId')::uuid)<>expected_count
     OR (SELECT count(*) FROM public.piggyvest_inflow_credits credit
       JOIN piggyvest_staging.goal_inflow_projections projection USING(provider_transaction_id)
       WHERE projection.goal_id=(scope->>'goalId')::uuid)<>expected_count THEN
    RAISE EXCEPTION 'legacy projection/credit/contribution set is incomplete or conflicted' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(proof->'credits')<>expected_count OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(proof->'credits') item
    WHERE jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>9
      OR NOT item ?& ARRAY['receiptId','payloadSha256','originalPayloadIntegrity','provenance','signatureStatus',
        'providerReconciliation','legacyProviderTransactionId','contributionId','observation']
      OR (item->>'receiptId')::uuid IS NULL OR item->>'payloadSha256' !~ '^[a-f0-9]{64}$'
      OR item->>'legacyProviderTransactionId' IS NULL OR item->>'contributionId' IS NULL
      OR item->>'originalPayloadIntegrity'<>'aead_authenticated'
      OR item->>'provenance' IS DISTINCT FROM 'provider_reconciliation'
      OR item->>'signatureStatus' IS DISTINCT FROM 'unavailable'
      OR jsonb_typeof(item->'providerReconciliation') IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(item->'providerReconciliation'))<>3
      OR NOT (item->'providerReconciliation') ?& ARRAY['transactionId','responseSha256','retrievedAt']
      OR item->'providerReconciliation'->>'transactionId' IS DISTINCT FROM item->'observation'->>'providerTransactionId'
      OR item->'providerReconciliation'->>'responseSha256' !~ '^[a-f0-9]{64}$'
      OR (item->'providerReconciliation'->>'retrievedAt')::timestamptz > (proof->>'verifiedAt')::timestamptz
      OR (proof->>'verifiedAt')::timestamptz-(item->'providerReconciliation'->>'retrievedAt')::timestamptz > interval '15 minutes'
      OR jsonb_typeof(item->'observation') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'legacy owner proof set incomplete or malformed' USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(proof->'credits') item
    LEFT JOIN piggyvest_staging.goal_inflow_projections projection
      ON projection.provider_transaction_id=item->>'legacyProviderTransactionId'
      AND projection.contribution_id=(item->>'contributionId')::uuid
      AND projection.goal_id=(scope->>'goalId')::uuid
    LEFT JOIN public.piggyvest_inflow_credits credit
      ON credit.provider_transaction_id=projection.provider_transaction_id
    LEFT JOIN public.customer_savings_contributions contribution
      ON contribution.id=projection.contribution_id
    CROSS JOIN LATERAL (SELECT item->'observation' AS observation) normalized
    WHERE projection.provider_transaction_id IS NULL OR credit.provider_transaction_id IS NULL
      OR contribution.id IS NULL
      OR normalized.observation->>'fingerprint' IS DISTINCT FROM item->>'payloadSha256'
      OR normalized.observation->>'eventId' IS DISTINCT FROM projection.event_id
      OR normalized.observation->>'eventDataId' IS DISTINCT FROM projection.event_data_id
      OR normalized.observation->>'providerTransactionId' IS DISTINCT FROM item->'providerReconciliation'->>'transactionId'
      OR normalized.observation->>'destinationCustomerId' IS DISTINCT FROM projection.provider_customer_id
      OR normalized.observation->>'destinationWalletId' IS DISTINCT FROM projection.provider_wallet_id
      OR normalized.observation->>'amountKobo' IS DISTINCT FROM projection.amount_kobo::text
      OR normalized.observation->>'feeKobo' IS DISTINCT FROM '0'
      OR normalized.observation->>'currency' IS DISTINCT FROM 'NGN'
      OR normalized.observation->>'reference' IS DISTINCT FROM projection.reference
      OR normalized.observation->>'sessionId' IS DISTINCT FROM projection.session_id
      OR (normalized.observation->>'creditedAt')::timestamptz IS DISTINCT FROM projection.credited_at
      OR normalized.observation->>'kind' IS DISTINCT FROM 'bank_inflow'
      OR normalized.observation->>'status' IS DISTINCT FROM 'verified'
      OR normalized.observation->>'eventType' IS DISTINCT FROM 'bank-transfer.inflow.success'
      OR normalized.observation->>'sourceWalletId' IS DISTINCT FROM ''
      OR jsonb_typeof(normalized.observation->'references') IS DISTINCT FROM 'array'
      OR NOT ((normalized.observation->'references') ? (item->>'legacyProviderTransactionId'))
      OR NOT ((normalized.observation->'references') ? (normalized.observation->>'providerTransactionId'))
      OR (SELECT count(*) FROM jsonb_object_keys(normalized.observation))<>19
      OR NOT normalized.observation ?& ARRAY['eventId','fingerprint','eventType','eventCategory','status','kind',
        'providerTransactionId','destinationCustomerId','sourceWalletId','destinationWalletId','reference','references',
        'amountKobo','feeKobo','currency','eventDataId','envelopeWalletId','sessionId','creditedAt']
      OR normalized.observation->>'eventCategory' NOT IN ('bank-transfer','inflow_transaction')
      OR normalized.observation->>'envelopeWalletId' IS NULL
      OR (normalized.observation->>'amountKobo')::bigint<=0
      OR normalized.observation->>'eventDataId' IS NULL
      OR (normalized.observation->>'creditedAt')::timestamptz IS DISTINCT FROM projection.credited_at
      OR contribution.amount*100 IS DISTINCT FROM projection.amount_kobo
      OR contribution.idempotency_key IS DISTINCT FROM 'piggyvest:'||projection.provider_transaction_id
      OR credit.amount_kobo IS DISTINCT FROM projection.amount_kobo
      OR credit.fee_kobo IS DISTINCT FROM 0
      OR credit.reference IS DISTINCT FROM projection.reference
      OR credit.session_id IS DISTINCT FROM projection.session_id
      OR credit.credited_at IS DISTINCT FROM projection.credited_at
  ) THEN
    RAISE EXCEPTION 'owner proof does not exactly match signed legacy projection and replay contract' USING ERRCODE='23514';
  END IF;

  SELECT coalesce(sum(posting.amount_kobo),0) INTO canonical_principal
    FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    WHERE operation.integration_id=(scope->>'integrationId')::uuid
      AND operation.merchant_id=(scope->>'merchantId')::uuid
      AND operation.customer_id=(scope->>'customerId')::uuid
      AND operation.goal_id=(scope->>'goalId')::uuid AND posting.account='principal';
  existing := EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=(scope->>'goalId')::uuid)
    OR EXISTS(SELECT 1 FROM prefunded_card.evidence_authorities WHERE integration_id=(scope->>'integrationId')::uuid)
    OR EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=(scope->>'goalId')::uuid)
    OR EXISTS(SELECT 1 FROM prefunded_card.bank_projections WHERE goal_id=(scope->>'goalId')::uuid)
    OR EXISTS(SELECT 1 FROM prefunded_card.provider_evidence WHERE integration_id=(scope->>'integrationId')::uuid
      AND (event_id IN (SELECT item->'observation'->>'eventId' FROM jsonb_array_elements(proof->'credits') item)
        OR observation->>'providerTransactionId' IN
          (SELECT item->'observation'->>'providerTransactionId' FROM jsonb_array_elements(proof->'credits') item)))
    OR EXISTS(SELECT 1 FROM prefunded_card.operations WHERE goal_id=(scope->>'goalId')::uuid);
  IF existing THEN
    IF NOT EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings binding
        WHERE binding.goal_id=(scope->>'goalId')::uuid AND binding.integration_id=(scope->>'integrationId')::uuid
          AND binding.merchant_id=(scope->>'merchantId')::uuid AND binding.customer_id=(scope->>'customerId')::uuid
          AND binding.authorized_login='prefunded_treasury_operator' AND binding.enabled)
      OR NOT EXISTS(SELECT 1 FROM prefunded_card.evidence_authorities authority
        WHERE authority.integration_id=(scope->>'integrationId')::uuid
          AND authority.business_id=scope->>'businessId' AND authority.system_identifier=observed
          AND authority.ingestion_login='prefunded_evidence' AND authority.reader_login='prefunded_treasury_operator'
          AND authority.currency='NGN' AND authority.enabled)
      OR EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=(scope->>'goalId')::uuid)
      OR canonical_principal<>10000
      OR (SELECT count(*) FROM prefunded_card.bank_projections projection
        WHERE projection.goal_id=(scope->>'goalId')::uuid)<>expected_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'credits') item
        JOIN LATERAL (SELECT item->'observation'->>'providerTransactionId' AS provider_tx,
          item->'observation'->>'eventId' AS event_id,(item->>'contributionId')::uuid AS contribution_id,
          (item->'observation'->>'amountKobo')::bigint AS amount_kobo) proof_item ON true
        LEFT JOIN prefunded_card.bank_projections projection
          ON projection.integration_id=(scope->>'integrationId')::uuid
          AND projection.provider_transaction_id=proof_item.provider_tx
        WHERE projection.event_id IS DISTINCT FROM proof_item.event_id
          OR projection.contribution_id IS DISTINCT FROM proof_item.contribution_id
          OR projection.amount_kobo IS DISTINCT FROM proof_item.amount_kobo
          OR projection.merchant_id IS DISTINCT FROM (scope->>'merchantId')::uuid
          OR projection.customer_id IS DISTINCT FROM (scope->>'customerId')::uuid
          OR projection.goal_id IS DISTINCT FROM (scope->>'goalId')::uuid)
      OR (SELECT count(*) FROM piggyvest_savings_ledger.operations operation
        WHERE operation.integration_id=(scope->>'integrationId')::uuid AND operation.goal_id=(scope->>'goalId')::uuid)<>expected_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'credits') item
        CROSS JOIN LATERAL (SELECT md5('legacy-opening-v1:'||(scope->>'integrationId')||':'||
          (item->>'legacyProviderTransactionId'))::uuid AS operation_id,
          (item->'observation'->>'amountKobo')::bigint AS amount_kobo) expected
        LEFT JOIN piggyvest_savings_ledger.operations operation ON operation.id=expected.operation_id
        WHERE operation.id IS NULL OR operation.goal_id<>(scope->>'goalId')::uuid
          OR operation.command->>'kind'<>'credit_principal'
          OR (operation.command->>'principalKobo')::bigint<>expected.amount_kobo
          OR operation.command->>'evidenceId'<>'legacy-opening-v1:'||expected.operation_id::text
          OR (SELECT count(*) FROM piggyvest_savings_ledger.postings posting WHERE posting.operation_id=operation.id)<>2
          OR (SELECT amount_kobo FROM piggyvest_savings_ledger.postings WHERE operation_id=operation.id AND account='principal')<>expected.amount_kobo
          OR (SELECT amount_kobo FROM piggyvest_savings_ledger.postings WHERE operation_id=operation.id AND account='internal_clearing')<>-expected.amount_kobo)
      OR (SELECT count(*) FROM prefunded_card.provider_evidence WHERE integration_id=(scope->>'integrationId')::uuid
          AND observation->>'status'='verified' AND NOT conflicted
          AND event_id IN (SELECT item->'observation'->>'eventId' FROM jsonb_array_elements(proof->'credits') item))<>expected_count
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'credits') item
        JOIN prefunded_card.provider_evidence receipt ON receipt.integration_id=(scope->>'integrationId')::uuid
          AND receipt.event_id=item->'observation'->>'eventId'
        WHERE receipt.conflicted OR receipt.fingerprint IS DISTINCT FROM item->>'payloadSha256'
          OR receipt.observation IS DISTINCT FROM item->'observation'
          OR receipt.business_id IS DISTINCT FROM scope->>'businessId'
          OR receipt.ingestion_login IS DISTINCT FROM session_user) THEN
      RAISE EXCEPTION 'partial or conflicting prior legacy enrollment refused' USING ERRCODE='23514';
    END IF;
    PERFORM set_config('legacy_enrollment.already_complete','on',true);
  ELSE
    IF canonical_principal<>0 OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations operation
        WHERE operation.goal_id=(scope->>'goalId')::uuid)
      OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.postings posting
        JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
        WHERE operation.goal_id=(scope->>'goalId')::uuid)
      OR EXISTS(SELECT 1 FROM prefunded_card.provider_evidence WHERE integration_id=(scope->>'integrationId')::uuid
        AND observation->>'providerTransactionId' IN (SELECT item->'observation'->>'providerTransactionId'
          FROM jsonb_array_elements(proof->'credits') item)) THEN
      RAISE EXCEPTION 'non-empty or partial canonical enrollment refused' USING ERRCODE='23514';
    END IF;
  END IF;
END
$preflight$;
