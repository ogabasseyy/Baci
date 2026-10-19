BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO, YMD';
SET LOCAL stats_fetch_consistency='none';
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $background_identity$ BEGIN
  IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
    OR current_database() IS DISTINCT FROM 'postgres'
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
    OR (SELECT usename FROM pg_stat_activity WHERE pid=pg_backend_pid()) IS DISTINCT FROM 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
    RAISE EXCEPTION 'background_preflight_identity_refused' USING ERRCODE='42501';
  END IF;
END $background_identity$;
WITH moment AS MATERIALIZED (SELECT clock_timestamp() at), expected AS MATERIALIZED (
  SELECT 'ff561046-58e7-428d-9163-f6e60b0dab65'::uuid operation_id,
    '9f01153c-1589-4dde-b9aa-8f644a846832'::uuid new_goal_id,
    '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid old_goal_id,
    'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'::uuid treasury_binding_id
), target_operation AS MATERIALIZED (
  SELECT operation.* FROM prefunded_card.operations operation,expected WHERE operation.id=expected.operation_id
), target_intent AS MATERIALIZED (
  SELECT intent.* FROM prefunded_card.checkout_intents intent,expected WHERE intent.operation_id=expected.operation_id
), target_queue AS MATERIALIZED (
  SELECT queue.* FROM prefunded_card.dispatch_queue queue,expected WHERE queue.operation_id=expected.operation_id
), target_binding AS MATERIALIZED (
  SELECT binding.* FROM prefunded_card.treasury_bindings binding,expected WHERE binding.id=expected.treasury_binding_id
), scope AS MATERIALIZED (
  SELECT expected.*,operation.integration_id,operation.merchant_id,operation.customer_id,
    binding.expected_business_id business_id,binding.authorized_login worker_login,
    (SELECT system_identifier::text FROM pg_control_system()) system_identifier
  FROM expected LEFT JOIN target_operation operation ON true LEFT JOIN target_binding binding ON true
), scoped_recovery AS MATERIALIZED (
  SELECT count(*) count FROM prefunded_card.checkout_intents stored
    JOIN prefunded_card.treasury_bindings binding ON binding.id=stored.treasury_binding_id CROSS JOIN scope
    WHERE stored.deployment='staging'
      AND stored.integration_id=scope.integration_id
      AND stored.merchant_id=scope.merchant_id
      AND stored.treasury_binding_id=scope.treasury_binding_id
      AND stored.business_id=scope.business_id
      AND stored.system_identifier=scope.system_identifier
      AND stored.expires_at='2026-10-06T15:59:10Z'::timestamptz
      AND stored.database_name=current_database()
      AND stored.phase IN ('initializing','ready','pending')
      AND binding.integration_id=stored.integration_id
      AND binding.merchant_id=stored.merchant_id
      AND binding.expected_business_id=stored.business_id
      AND binding.authorized_login=stored.authorized_login
      AND binding.currency='NGN'
), leases(kind,token_present,expiry) AS MATERIALIZED (
  SELECT 'verification',verification_token IS NOT NULL,verification_lease_expires_at FROM prefunded_card.operations
  UNION ALL SELECT 'initialization',initialization_token IS NOT NULL,initialization_lease_expires_at
    FROM prefunded_card.checkout_intents
  UNION ALL SELECT 'dispatch',claim_token IS NOT NULL,lease_expires_at FROM prefunded_card.dispatch_queue
), drain AS MATERIALIZED (
  SELECT jsonb_build_object(
    'preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts),
    'otherClientTransactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND backend_type='client backend' AND xact_start IS NOT NULL),
    'activeVerificationLeases',count(*) FILTER (WHERE kind='verification' AND expiry>moment.at),
    'activeInitializationLeases',count(*) FILTER (WHERE kind='initialization' AND expiry>moment.at),
    'activeDispatchLeases',count(*) FILTER (WHERE kind='dispatch' AND expiry>moment.at),
    'malformedVerificationPairs',count(*) FILTER (WHERE kind='verification' AND token_present<>(expiry IS NOT NULL)),
    'malformedInitializationPairs',count(*) FILTER (WHERE kind='initialization' AND token_present<>(expiry IS NOT NULL)),
    'malformedDispatchPairs',count(*) FILTER (WHERE kind='dispatch' AND token_present<>(expiry IS NOT NULL)),
    'expiredVerificationPairs',count(*) FILTER (WHERE kind='verification' AND token_present AND expiry<=moment.at),
    'expiredInitializationPairs',count(*) FILTER (WHERE kind='initialization' AND token_present AND expiry<=moment.at),
    'expiredDispatchPairs',count(*) FILTER (WHERE kind='dispatch' AND token_present AND expiry<=moment.at)
  ) payload FROM leases CROSS JOIN moment
), work AS MATERIALIZED (
  SELECT jsonb_build_object(
    'otherNonretiredUnfinishedOperations',(SELECT count(*) FROM prefunded_card.operations operation,expected
      WHERE operation.id IS DISTINCT FROM expected.operation_id AND operation.checkout_retired IS DISTINCT FROM true
        AND (operation.projection_status IS DISTINCT FROM 'applied' OR EXISTS (
          SELECT 1 FROM prefunded_card.dispatch_queue queue WHERE queue.operation_id=operation.id AND queue.finished_at IS NULL))),
    'recoveryPhaseIntents',(SELECT count(*) FROM prefunded_card.checkout_intents WHERE phase IN ('initializing','ready','pending')),
    'scopedRecoveryCandidates',(SELECT count FROM scoped_recovery)
  ) payload
), principals AS MATERIALIZED (
  SELECT jsonb_build_object(
    'newGoal',(SELECT CASE WHEN current_amount*100=trunc(current_amount*100)
      THEN (current_amount*100)::bigint ELSE NULL END
      FROM public.customer_savings_goals goal,expected WHERE goal.id=expected.new_goal_id),
    'oldGoal',(SELECT CASE WHEN current_amount*100=trunc(current_amount*100)
      THEN (current_amount*100)::bigint ELSE NULL END
      FROM public.customer_savings_goals goal,expected WHERE goal.id=expected.old_goal_id)
  ) payload
), treasury AS MATERIALIZED (
  SELECT jsonb_build_object('budgetKobo',(SELECT verified_available_kobo FROM target_binding),
    'reservedKobo',(SELECT reserved_kobo FROM target_binding),'consumedKobo',(SELECT consumed_kobo FROM target_binding)) payload
), phase AS MATERIALIZED (
  SELECT CASE
    WHEN operation.projection_status='unapplied' AND operation.transfer_status='dispatching'
      THEN 'verify_existing_transfer'
    WHEN operation.projection_status='unapplied' AND operation.transfer_status='verified_success'
      AND operation.transfer_provider_transaction_id='PVB01M3YP6SFJQTJQWE83SC5RMX1V'
      THEN 'apply_verified_projection'
    ELSE NULL END name
  FROM scope LEFT JOIN target_operation operation ON true
), recovery_routine AS MATERIALIZED (
  SELECT jsonb_build_object('oid',routine.oid::bigint,'owner',pg_get_userbyid(routine.proowner),
    'securityDefiner',routine.prosecdef,'configuration',routine.proconfig,
    'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')) payload
  FROM (SELECT to_regprocedure('prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)')::oid oid) target
    LEFT JOIN pg_proc routine ON routine.oid=target.oid
), checks AS MATERIALIZED (
  SELECT code FROM scope CROSS JOIN moment CROSS JOIN drain CROSS JOIN work CROSS JOIN principals
    CROSS JOIN treasury CROSS JOIN phase CROSS JOIN recovery_routine CROSS JOIN LATERAL (VALUES
    ('target_state',NOT EXISTS (SELECT 1 FROM target_operation WHERE collection_status='verified_success'
      AND phase.name IS NOT NULL AND projection_status='unapplied' AND transfer_attempted_at IS NOT NULL
      AND checkout_retired=false AND amount_kobo=10000 AND currency='NGN'
      AND goal_id=scope.new_goal_id AND treasury_binding_id=scope.treasury_binding_id)),
    ('target_checkout',(SELECT count(*) FROM target_intent)<>1 OR NOT EXISTS (
      SELECT 1 FROM target_intent intent JOIN target_operation operation ON operation.id=intent.operation_id
        JOIN target_binding binding ON binding.id=intent.treasury_binding_id
      WHERE intent.id=scope.operation_id AND intent.deployment='staging' AND intent.phase='funding_pending'
        AND intent.verified_collection IS NOT NULL AND jsonb_typeof(intent.verified_collection)='object'
        AND intent.integration_id=operation.integration_id AND intent.merchant_id=operation.merchant_id
        AND intent.customer_id=operation.customer_id AND intent.goal_id=scope.new_goal_id
        AND intent.treasury_binding_id=operation.treasury_binding_id AND intent.business_id=binding.expected_business_id
        AND intent.system_identifier=scope.system_identifier AND intent.database_name=current_database()
        AND intent.authorized_login=binding.authorized_login AND intent.amount_kobo=10000 AND intent.currency='NGN'
        AND intent.expires_at='2026-10-06T15:59:10Z'::timestamptz
        AND binding.integration_id=operation.integration_id AND binding.merchant_id=operation.merchant_id AND binding.currency='NGN')),
    ('target_queue',(SELECT count(*) FROM target_queue)<>1 OR NOT EXISTS (SELECT 1 FROM target_queue
      WHERE finished_at IS NULL AND available_at<=moment.at AND claim_token IS NULL AND lease_expires_at IS NULL)),
    ('principals',principals.payload IS DISTINCT FROM '{"newGoal":0,"oldGoal":10000}'::jsonb),
    ('budget',treasury.payload IS DISTINCT FROM CASE phase.name
      WHEN 'verify_existing_transfer' THEN '{"budgetKobo":10000,"reservedKobo":10000,"consumedKobo":0}'::jsonb
      WHEN 'apply_verified_projection' THEN '{"budgetKobo":10000,"reservedKobo":0,"consumedKobo":10000}'::jsonb
      ELSE NULL END),
    ('verification_leases',(drain.payload->>'activeVerificationLeases')::bigint<>0
      OR (drain.payload->>'malformedVerificationPairs')::bigint<>0 OR (drain.payload->>'expiredVerificationPairs')::bigint<>0),
    ('initialization_leases',(drain.payload->>'activeInitializationLeases')::bigint<>0
      OR (drain.payload->>'malformedInitializationPairs')::bigint<>0 OR (drain.payload->>'expiredInitializationPairs')::bigint<>0),
    ('dispatch_leases',(drain.payload->>'activeDispatchLeases')::bigint<>0
      OR (drain.payload->>'malformedDispatchPairs')::bigint<>0 OR (drain.payload->>'expiredDispatchPairs')::bigint<>0),
    ('prepared_transactions',(drain.payload->>'preparedTransactions')::bigint<>0),
    ('client_transactions',(drain.payload->>'otherClientTransactions')::bigint<>0),
    ('other_operations',(work.payload->>'otherNonretiredUnfinishedOperations')::bigint<>0),
    ('recovery_candidates',(work.payload->>'scopedRecoveryCandidates')::bigint<>0),
    ('recovery_phases',(work.payload->>'recoveryPhaseIntents')::bigint<>0),
    ('recovery_routine',recovery_routine.payload->>'bodySha256' IS DISTINCT FROM
      'f5266e9f873682afdaa2a7083ac6dbe0a636c383eea708489543cdc37ec2f1a5')
  ) conditions(code,blocked) WHERE blocked IS DISTINCT FROM false
)
SELECT jsonb_build_object('version',1,'phase',phase.name,
  'capturedAt',to_char(moment.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'identity',jsonb_build_object('systemIdentifier',scope.system_identifier,'database',current_database(),
    'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
    'sessionUser',session_user,'currentUser',current_user,'localSocket',inet_client_addr() IS NULL,
    'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation')),
  'scope',jsonb_build_object('operationId',scope.operation_id,'newGoalId',scope.new_goal_id,'oldGoalId',scope.old_goal_id,
    'treasuryBindingId',scope.treasury_binding_id,'integrationId',scope.integration_id,'merchantId',scope.merchant_id,
    'customerId',scope.customer_id,'businessId',scope.business_id,'workerLogin',scope.worker_login),
  'target',jsonb_build_object('operationCount',(SELECT count(*) FROM target_operation),'intentCount',(SELECT count(*) FROM target_intent),
    'queueCount',(SELECT count(*) FROM target_queue),'collectionStatus',(SELECT collection_status FROM target_operation),
    'transferStatus',(SELECT transfer_status FROM target_operation),'projectionStatus',(SELECT projection_status FROM target_operation),
    'transferProviderTransactionId',(SELECT transfer_provider_transaction_id FROM target_operation),
    'transferAttemptedAt',(SELECT transfer_attempted_at FROM target_operation),'checkoutPhase',(SELECT phase FROM target_intent),
    'queueAvailableAt',(SELECT available_at FROM target_queue),'queueFinishedAt',(SELECT finished_at FROM target_queue)),
  'principalsKobo',principals.payload,'treasury',treasury.payload,'drain',drain.payload,'work',work.payload,
  'recoveryRoutine',recovery_routine.payload,
  'predicateSourceSha256','75edc85b3f7b76f8501f7799696c017dff5b879f28a3d671d8e25a73b2c0a0d9',
  'renewalSourceSha256','f947078b85964ce4dff797feec9cc08c09c1c85b689a5a95682c83c9869e7912',
  'blockers',coalesce((SELECT jsonb_agg(code ORDER BY code COLLATE "C") FROM checks),'[]'::jsonb)
) evidence FROM scope CROSS JOIN moment CROSS JOIN drain CROSS JOIN work CROSS JOIN principals CROSS JOIN treasury CROSS JOIN phase CROSS JOIN recovery_routine;
DO $background_deadline$ BEGIN
  IF clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'background_preflight_identity_refused' USING ERRCODE='42501';
  END IF;
END $background_deadline$;
ROLLBACK;
