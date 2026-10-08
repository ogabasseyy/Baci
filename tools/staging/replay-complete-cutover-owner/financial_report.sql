BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
WITH context AS (
  SELECT 'ff561046-58e7-428d-9163-f6e60b0dab65'::uuid AS operation_id,
    '9f01153c-1589-4dde-b9aa-8f644a846832'::uuid AS goal_id,
    '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid AS old_goal_id,
    'd91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid AS integration_id,
    'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid AS treasury_id,
    '01M3YP771123DWC9Y8Y4814Z8Y'::text AS event_id,
    'PVB01M3YP6SFJQTJQWE83SC5RMX1V'::text AS native_transaction_id,
    'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65'::text AS transfer_reference,
    'pvb-card:ff561046-58e7-428d-9163-f6e60b0dab65'::text AS evidence_key
), identity AS MATERIALIZED (
  SELECT system_identifier::text AS system_identifier, session_user::text AS login,
    current_user::text AS role, current_database() AS database,
    inet_client_addr() IS NULL AS local_unix,
    current_setting('transaction_read_only')='on' AS read_only,
    clock_timestamp() AS observed_at FROM pg_control_system()
), evidence AS MATERIALIZED (
  SELECT entry.integration_id,entry.event_id,entry.fingerprint,entry.business_id,
    entry.created_at,entry.conflicted,entry.observation
  FROM prefunded_card.provider_evidence entry CROSS JOIN context scope
  WHERE entry.integration_id=scope.integration_id AND (
    entry.event_id=scope.event_id OR (entry.observation->'references') ? scope.transfer_reference
    OR entry.observation->>'providerTransactionId'=scope.native_transaction_id)
), replenishments AS (
  SELECT treasury_binding_id,sum(amount_kobo)::bigint AS amount_kobo
  FROM prefunded_card.treasury_replenishments GROUP BY treasury_binding_id
)
SELECT jsonb_build_object(
  'schemaVersion',1,'reportKind','application_financial_subreport',
  'observedAt',to_char(identity.observed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'appIdentity',jsonb_build_object('systemIdentifier',identity.system_identifier,
    'sessionUser',identity.login,'currentUser',identity.role,'database',identity.database,
    'localUnix',identity.local_unix,'readOnly',identity.read_only),
  'nativeApplication',jsonb_build_object(
    'scope',CASE WHEN operation.id IS NULL THEN NULL ELSE jsonb_build_object(
      'operationId',operation.id,'goalId',operation.goal_id,
      'oldGoalId',(SELECT id FROM public.customer_savings_goals WHERE id=scope.old_goal_id
        AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id),
      'integrationId',operation.integration_id,'treasuryBindingId',operation.treasury_binding_id,
      'merchantId',operation.merchant_id,'customerId',operation.customer_id,
      'businessId',treasury.expected_business_id,'sourceWalletId',treasury.source_wallet_id,
      'destinationWalletId',operation.destination_wallet_id,'destinationCustomerId',operation.destination_customer_id,
      'amountKobo',operation.amount_kobo,'currency',operation.currency,
      'executionDeadline','2026-10-06T15:59:10Z') END,
    'collection',CASE WHEN operation.id IS NULL THEN NULL ELSE jsonb_build_object(
      'operationId',operation.id,'status',operation.collection_status,'amountKobo',operation.amount_kobo,
      'currency',operation.currency,'providerTransactionId',operation.collection_provider_transaction_id) END,
    'evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'integrationId',entry.integration_id,'eventId',entry.event_id,'fingerprint',entry.fingerprint,
      'businessId',entry.business_id,'createdAt',to_char(entry.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'conflicted',entry.conflicted,'status',entry.observation->'status','kind',entry.observation->'kind',
      'eventType',entry.observation->'eventType','eventCategory',entry.observation->'eventCategory',
      'providerTransactionId',entry.observation->'providerTransactionId','reference',entry.observation->'reference',
      'references',entry.observation->'references','sourceWalletId',entry.observation->'sourceWalletId',
      'destinationWalletId',entry.observation->'destinationWalletId',
      'destinationCustomerId',entry.observation->'destinationCustomerId',
      'amountKobo',entry.observation->'amountKobo','currency',entry.observation->'currency',
      'feeKobo',entry.observation->'feeKobo') ORDER BY entry.event_id),'[]'::jsonb) FROM evidence entry),
    'conflicts',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'integrationId',conflict.integration_id,'eventId',conflict.event_id,'operationId',conflict.operation_id,
      'alreadyApplied',conflict.already_applied,
      'recordedAt',to_char(conflict.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY conflict.event_id,conflict.operation_id),'[]'::jsonb)
      FROM prefunded_card.evidence_conflicts conflict WHERE conflict.integration_id=scope.integration_id
        AND (conflict.event_id=scope.event_id OR conflict.operation_id=scope.operation_id)),
    'applicationCrosswalk',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'publicWalletId',mapping.provider_wallet_id,'providerCustomerId',mapping.provider_customer_id,
      'mappingGoalId',mapping.goal_id,'mappingIntegrationId',mapping.integration_id,
      'sourceMatches',coalesce(entry.observation->>'sourceWalletId'=treasury.source_wallet_id,false),
      'destinationMatches',coalesce(entry.observation->>'destinationWalletId'=operation.destination_wallet_id,false),
      'customerMatches',coalesce(entry.observation->>'destinationCustomerId'=operation.destination_customer_id,false),
      'businessMatches',coalesce(entry.business_id=treasury.expected_business_id
        AND registry.expected_provider_account_id=treasury.expected_business_id,false),
      'referenceMatches',coalesce(entry.observation->>'reference'=operation.transfer_reference
        AND operation.transfer_reference=scope.transfer_reference,false),
      'nativeTransactionMatches',coalesce(entry.observation->>'providerTransactionId'=scope.native_transaction_id,false),
      'mappingWalletMatches',mapping.provider_wallet_id=operation.destination_wallet_id,
      'mappingCustomerMatches',mapping.provider_customer_id=operation.destination_customer_id)
      ORDER BY mapping.provider_wallet_id),'[]'::jsonb)
      FROM piggyvest_staging.wallet_goal_mappings mapping
      JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
      JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id
        AND goal.merchant_id=mapping.merchant_id AND goal.customer_id=mapping.customer_id
      JOIN prefunded_card.credit_routes route ON route.goal_id=mapping.goal_id
        AND route.integration_id=mapping.integration_id AND route.merchant_id=mapping.merchant_id
        AND route.customer_id=mapping.customer_id AND route.system_identifier=identity.system_identifier
      JOIN piggyvest_staging.integrations registry ON registry.id=mapping.integration_id AND registry.enabled
      LEFT JOIN evidence entry ON entry.event_id=scope.event_id
      WHERE mapping.integration_id=operation.integration_id AND mapping.goal_id=operation.goal_id
        AND mapping.merchant_id=operation.merchant_id AND mapping.customer_id=operation.customer_id)),
  'completedApplication',jsonb_build_object(
    'operation',CASE WHEN operation.id IS NULL THEN NULL ELSE jsonb_build_object(
      'operationId',operation.id,'goalId',operation.goal_id,'integrationId',operation.integration_id,
      'treasuryBindingId',operation.treasury_binding_id,'merchantId',operation.merchant_id,
      'customerId',operation.customer_id,'amountKobo',operation.amount_kobo,'currency',operation.currency,
      'destinationWalletId',operation.destination_wallet_id,'destinationCustomerId',operation.destination_customer_id,
      'checkoutRetired',operation.checkout_retired,'collectionStatus',operation.collection_status,
      'transferStatus',operation.transfer_status,'projectionStatus',operation.projection_status,
      'transferProviderTransactionId',operation.transfer_provider_transaction_id,
      'collectionProviderTransactionId',operation.collection_provider_transaction_id,
      'collectionProofPresent',intent.verified_collection IS NOT NULL,
      'verificationTokenPresent',operation.verification_token IS NOT NULL,
      'verificationLeaseExpiresAt',to_char(operation.verification_lease_expires_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'transferAttemptedAt',to_char(operation.transfer_attempted_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'intentPhase',intent.phase) END,
    'queue',(SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',queue.operation_id,
      'claimTokenPresent',queue.claim_token IS NOT NULL,
      'leaseExpiresAt',to_char(queue.lease_expires_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'finishedAt',to_char(queue.finished_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY queue.operation_id),'[]'::jsonb)
      FROM prefunded_card.dispatch_queue queue WHERE queue.operation_id=scope.operation_id),
    'unfinishedOperations',(SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',queue.operation_id)
      ORDER BY queue.operation_id),'[]'::jsonb) FROM prefunded_card.dispatch_queue queue
      WHERE queue.operation_id=scope.operation_id AND queue.finished_at IS NULL),
    'activeLeaseCount',((operation.verification_token IS NOT NULL OR operation.verification_lease_expires_at IS NOT NULL)::integer
      +(intent.initialization_token IS NOT NULL OR intent.initialization_lease_expires_at IS NOT NULL)::integer
      +(SELECT count(*) FROM prefunded_card.dispatch_queue queue WHERE queue.operation_id=scope.operation_id
        AND (queue.claim_token IS NOT NULL OR queue.lease_expires_at IS NOT NULL))),
    'treasury',CASE WHEN treasury.id IS NULL THEN NULL ELSE jsonb_build_object(
      'treasuryBindingId',treasury.id,'integrationId',treasury.integration_id,
      'businessId',treasury.expected_business_id,'sourceWalletId',treasury.source_wallet_id,
      'budgetKobo',treasury_identity.opening_available_kobo+coalesce(replenishment.amount_kobo,0),
      'openingAvailableKobo',treasury_identity.opening_available_kobo,
      'replenishedKobo',coalesce(replenishment.amount_kobo,0),
      'reservedKobo',treasury.reserved_kobo,'consumedKobo',treasury.consumed_kobo) END,
    'goals',(SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',goal.id,
      'displayedPrincipalKobo',CASE WHEN goal.current_amount*100=trunc(goal.current_amount*100)
        THEN (goal.current_amount*100)::bigint END,
      'canonicalPrincipalKobo',(SELECT coalesce(sum(posting.amount_kobo),0)::bigint
        FROM piggyvest_savings_ledger.postings posting JOIN piggyvest_savings_ledger.operations entry
          ON entry.id=posting.operation_id WHERE entry.goal_id=goal.id
          AND entry.integration_id=scope.integration_id AND posting.account='principal'))
      ||CASE WHEN goal.id=scope.goal_id THEN jsonb_build_object(
        'targetKobo',CASE WHEN goal.target_amount*100=trunc(goal.target_amount*100) THEN (goal.target_amount*100)::bigint END,
        'status',goal.status,'completedAt',to_char(goal.completed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ELSE '{}'::jsonb END
      ORDER BY goal.id),'[]'::jsonb) FROM public.customer_savings_goals goal WHERE goal.id IN (scope.goal_id,scope.old_goal_id)),
    'projections',(SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',projection.operation_id,
      'ledgerOperationId',projection.ledger_operation_id,'amountKobo',projection.amount_kobo,
      'contributionId',projection.contribution_id,'createdAt',to_char(projection.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY projection.operation_id),'[]'::jsonb) FROM prefunded_card.projections projection
      WHERE projection.operation_id=scope.operation_id),
    'ledgerOperations',(SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',entry.id,'goalId',entry.goal_id,
      'integrationId',entry.integration_id,'merchantId',entry.merchant_id,'customerId',entry.customer_id,
      'evidenceId',entry.evidence_id,'kind',entry.command->'kind',
      'principalKobo',entry.command->'principalKobo','interestKobo',entry.command->'interestKobo') ORDER BY entry.id),'[]'::jsonb)
      FROM piggyvest_savings_ledger.operations entry WHERE entry.id=scope.operation_id
        OR (entry.integration_id=scope.integration_id AND entry.evidence_id=scope.evidence_key)),
    'contributions',(SELECT coalesce(jsonb_agg(jsonb_build_object('contributionId',contribution.id,
      'goalId',contribution.goal_id,'merchantId',contribution.merchant_id,'customerId',contribution.customer_id,
      'amountKobo',CASE WHEN contribution.amount*100=trunc(contribution.amount*100) THEN (contribution.amount*100)::bigint END,
      'sourceType',contribution.source_type,'status',contribution.status,'idempotencyKey',contribution.idempotency_key,
      'metadataOperationId',contribution.metadata->'operation_id',
      'metadataProviderTransactionId',contribution.metadata->'provider_transaction_id',
      'transferReference',contribution.metadata->'transfer_reference') ORDER BY contribution.id),'[]'::jsonb)
      FROM public.customer_savings_contributions contribution WHERE contribution.idempotency_key=scope.evidence_key
        OR contribution.id IN (SELECT projection.contribution_id FROM prefunded_card.projections projection
          WHERE projection.operation_id=scope.operation_id)),
    'postings',(SELECT coalesce(jsonb_agg(jsonb_build_object('operationId',posting.operation_id,
      'account',posting.account,'amountKobo',posting.amount_kobo) ORDER BY posting.account),'[]'::jsonb)
      FROM piggyvest_savings_ledger.postings posting WHERE posting.operation_id=scope.operation_id),
    'aliases',(SELECT coalesce(jsonb_agg(jsonb_build_object('integrationId',alias.integration_id,
      'providerTransactionId',alias.provider_transaction_id,'operationId',alias.operation_id)
      ORDER BY alias.integration_id,alias.provider_transaction_id),'[]'::jsonb)
      FROM prefunded_card.provider_aliases alias WHERE alias.operation_id=scope.operation_id
        OR (alias.integration_id=scope.integration_id AND alias.provider_transaction_id=scope.native_transaction_id)),
    'notifications',(SELECT coalesce(jsonb_agg(jsonb_build_object('notificationId',event.id,
      'goalId',event.goal_id,'merchantId',event.merchant_id,'customerId',event.customer_id,
      'eventKey',event.event_key,'type',event.type,'voidedAt',to_char(event.voided_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ORDER BY event.event_key,event.id),'[]'::jsonb) FROM savings_notifications.events event
      WHERE event.goal_id=scope.goal_id AND (event.event_key='first-contribution' OR event.event_key LIKE 'milestone:%'
        OR event.type IN ('first_contribution','milestone','goal_completed'))))
) AS application_report
FROM context scope CROSS JOIN identity
LEFT JOIN prefunded_card.operations operation ON operation.id=scope.operation_id
LEFT JOIN prefunded_card.checkout_intents intent ON intent.operation_id=scope.operation_id
LEFT JOIN prefunded_card.treasury_bindings treasury ON treasury.id=operation.treasury_binding_id
LEFT JOIN prefunded_card.treasury_identities treasury_identity ON treasury_identity.treasury_binding_id=treasury.id
LEFT JOIN replenishments replenishment ON replenishment.treasury_binding_id=treasury.id
WHERE identity.system_identifier='7685292944002592802' AND identity.login='postgres'
  AND identity.role='postgres' AND identity.database='postgres' AND identity.local_unix AND identity.read_only;
ROLLBACK;
