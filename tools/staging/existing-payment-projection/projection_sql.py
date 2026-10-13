"""Prepared SQL fragments, not execution authority or a live CLI.

Use one original postgres/local-Unix connection for all three APIs. The parent
binds source/audit/native receipt and checker metadata, preserves the failed
worker outside SQL, and validates full protected snapshots before COMMIT.
On any SQL/transport/validation failure the parent rolls back and proves idle
state/root session restoration, or closes the connection. No API commits.
"""

SYSTEM = '7685292944002592802'
OPERATION = 'ff561046-58e7-428d-9163-f6e60b0dab65'
ROLE = 'prefunded_treasury_operator'
DEADLINE = '2026-10-06T15:59:10Z'
SCOPE = dict(
    operationId=OPERATION, goalId='9f01153c-1589-4dde-b9aa-8f644a846832',
    oldGoalId='430314fd-cd8b-4579-98d4-e9f345713dd6',
    integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    merchantId='10000000-0000-4000-8000-000000000001',
    customerId='10000000-0000-4000-8000-000000000002',
    businessId='01M2381RG34HQJMHQKE7DWDACR', sourceWalletId='01M238A0V75387H4HZ15YFWGX3',
    destinationWalletId='01M3W0Y93XHJY9RPQ2G75X81WG',
    destinationCustomerId='c096507d-dc32-45d2-9c01-871a27abfd10',
    amountKobo=10000, currency='NGN', executionDeadline=DEADLINE)
TRANSFER = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'


def deadline_sql():
    """Return a no-row root/session/physical/deadline guard; never commit or roll back."""
    return f"""
DO $identity$
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres' OR current_database()<>'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '{SYSTEM}'
    OR current_setting('session_replication_role')<>'origin'
    OR current_setting('transaction_isolation')<>'read committed'
    OR current_setting('transaction_read_only')<>'off'
    OR current_setting('standard_conforming_strings')<>'on'
    OR clock_timestamp()>='{DEADLINE}'::timestamptz THEN
    RAISE EXCEPTION 'existing payment identity or deadline refused' USING ERRCODE='42501';
  END IF;
END $identity$;
"""


def start_sql():
    """Begin and retain locks plus one private baseline row; return no result rows."""
    scope = SCOPE
    return f"""
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL standard_conforming_strings=on;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
{deadline_sql()}
LOCK TABLE prefunded_card.dispatch_queue, prefunded_card.operations,
  prefunded_card.checkout_intents, prefunded_card.treasury_bindings,
  public.customer_savings_goals IN SHARE ROW EXCLUSIVE MODE;
DO $eligibility$
DECLARE candidates uuid[]; unfinished uuid[];
BEGIN
  SELECT array_agg(queue.operation_id ORDER BY queue.operation_id) INTO candidates
  FROM prefunded_card.dispatch_queue queue
  JOIN prefunded_card.operations operation ON operation.id=queue.operation_id
  JOIN prefunded_card.treasury_bindings binding ON binding.id=operation.treasury_binding_id
  WHERE binding.id='{scope['treasuryBindingId']}' AND binding.integration_id='{scope['integrationId']}'
    AND binding.merchant_id='{scope['merchantId']}' AND binding.expected_business_id='{scope['businessId']}'
    AND binding.authorized_login='{ROLE}' AND operation.integration_id='{scope['integrationId']}'
    AND queue.finished_at IS NULL AND queue.available_at<=clock_timestamp()
    AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at<=clock_timestamp())
    AND NOT EXISTS (SELECT 1 FROM prefunded_card.checkout_intents checkout_intent
      WHERE checkout_intent.operation_id=operation.id
        AND (checkout_intent.phase NOT IN ('funding_pending','completed')
          OR checkout_intent.verified_collection IS NULL));
  SELECT array_agg(queue.operation_id ORDER BY queue.operation_id) INTO unfinished
  FROM prefunded_card.dispatch_queue queue JOIN prefunded_card.operations operation
    ON operation.id=queue.operation_id
  WHERE operation.treasury_binding_id='{scope['treasuryBindingId']}' AND queue.finished_at IS NULL;
  IF candidates IS DISTINCT FROM ARRAY['{OPERATION}'::uuid]
    OR unfinished IS DISTINCT FROM ARRAY['{OPERATION}'::uuid] THEN
    RAISE EXCEPTION 'existing payment candidate set refused' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM prefunded_card.operations operation
    JOIN prefunded_card.treasury_bindings binding ON binding.id=operation.treasury_binding_id
    JOIN prefunded_card.checkout_intents intent ON intent.operation_id=operation.id
    JOIN prefunded_card.dispatch_queue queue ON queue.operation_id=operation.id
    JOIN public.customer_savings_goals goal ON goal.id=operation.goal_id
    JOIN public.customer_savings_goals old_goal ON old_goal.id='{scope['oldGoalId']}'
    WHERE operation.id='{OPERATION}' AND operation.integration_id='{scope['integrationId']}'
      AND operation.merchant_id='{scope['merchantId']}' AND operation.customer_id='{scope['customerId']}'
      AND operation.goal_id='{scope['goalId']}' AND operation.treasury_binding_id='{scope['treasuryBindingId']}'
      AND operation.amount_kobo=10000 AND operation.fee_allowance_kobo=0 AND operation.currency='NGN'
      AND operation.destination_wallet_id='{scope['destinationWalletId']}'
      AND operation.destination_customer_id='{scope['destinationCustomerId']}'
      AND operation.transfer_reference='pvbt-{OPERATION}'
      AND operation.collection_reference='pvb-first-{OPERATION}'
      AND operation.idempotency_key=intent.idempotency_hash
      AND operation.request_fingerprint=intent.request_fingerprint
      AND operation.saved_method_id=intent.prepared_saved_method_id
      AND operation.collection_status='verified_success' AND operation.transfer_status='verified_success'
      AND operation.projection_status='unapplied' AND NOT operation.checkout_retired
      AND nullif(operation.collection_provider_transaction_id,'') IS NOT NULL
      AND operation.transfer_provider_transaction_id='{TRANSFER}'
      AND operation.collection_fence=0 AND operation.transfer_fence=1
      AND operation.verification_token IS NULL AND operation.verification_lease_expires_at IS NULL
      AND intent.phase IN ('funding_pending','completed') AND intent.verified_collection IS NOT NULL
      AND intent.id=operation.id AND intent.deployment='staging'
      AND intent.integration_id=operation.integration_id AND intent.merchant_id=operation.merchant_id
      AND intent.customer_id=operation.customer_id AND intent.goal_id=operation.goal_id
      AND intent.treasury_binding_id=operation.treasury_binding_id
      AND intent.business_id=binding.expected_business_id AND intent.system_identifier='{SYSTEM}'
      AND intent.database_name='postgres' AND intent.authorized_login='{ROLE}'
      AND intent.amount_kobo=operation.amount_kobo AND intent.currency=operation.currency
      AND intent.reference=operation.collection_reference AND intent.transfer_reference=operation.transfer_reference
      AND intent.initialization_token IS NULL AND intent.initialization_lease_expires_at IS NULL
      AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at<=clock_timestamp())
      AND queue.finished_at IS NULL
      AND binding.integration_id='{scope['integrationId']}' AND binding.merchant_id='{scope['merchantId']}'
      AND binding.expected_business_id='{scope['businessId']}' AND binding.source_wallet_id='{scope['sourceWalletId']}'
      AND binding.authorized_login='{ROLE}' AND binding.currency='NGN' AND binding.enabled
      AND binding.reserved_kobo=0 AND binding.consumed_kobo=10000
      AND goal.merchant_id='{scope['merchantId']}' AND goal.customer_id='{scope['customerId']}'
      AND goal.current_amount=0 AND goal.target_amount>=100 AND goal.status='active'
      AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL
      AND old_goal.merchant_id='{scope['merchantId']}' AND old_goal.customer_id='{scope['customerId']}'
      AND old_goal.current_amount=100)
    OR EXISTS (SELECT 1 FROM prefunded_card.projections WHERE operation_id='{OPERATION}')
    OR EXISTS (SELECT 1 FROM piggyvest_savings_ledger.operations WHERE id='{OPERATION}')
    OR EXISTS (SELECT 1 FROM prefunded_card.provider_aliases WHERE operation_id='{OPERATION}')
    OR EXISTS (SELECT 1 FROM public.customer_savings_contributions WHERE goal_id='{scope['goalId']}') THEN
    RAISE EXCEPTION 'existing payment scope or state refused' USING ERRCODE='42501';
  END IF;
END $eligibility$;
CREATE TEMP TABLE existing_payment_projection_before ON COMMIT DROP AS
  SELECT queue.attempts, to_jsonb(queue) AS queue_before, to_jsonb(binding) AS treasury
  FROM prefunded_card.dispatch_queue queue CROSS JOIN prefunded_card.treasury_bindings binding
  WHERE queue.operation_id='{OPERATION}' AND binding.id='{scope['treasuryBindingId']}';
{deadline_sql()}
"""


def mutate_sql():
    """Claim/project/finish once under the restricted session; leave commit to the parent."""
    scope = SCOPE
    return f"""
{deadline_sql()}
DO $prepared$
BEGIN
  IF (SELECT count(*) FROM pg_temp.existing_payment_projection_before)<>1 THEN
    RAISE EXCEPTION 'existing payment baseline refused' USING ERRCODE='42501';
  END IF;
END $prepared$;
SET SESSION AUTHORIZATION {ROLE};
DO $projection$
DECLARE claims jsonb; claim jsonb; token uuid; outcome text; finished boolean;
BEGIN
  claims:=prefunded_card.claim_due('{scope['integrationId']}','{scope['businessId']}',
    '{SYSTEM}',1,'{scope['merchantId']}','{scope['treasuryBindingId']}');
  IF jsonb_typeof(claims) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'existing payment claim refused' USING ERRCODE='42501';
  END IF;
  IF jsonb_array_length(claims)<>1 THEN
    RAISE EXCEPTION 'existing payment claim count refused' USING ERRCODE='42501';
  END IF;
  claim:=claims->0;
  IF jsonb_typeof(claim) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'existing payment claim shape refused' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(claim))<>2
    OR claim->>'operationId' IS DISTINCT FROM '{OPERATION}'
    OR jsonb_typeof(claim->'token') IS DISTINCT FROM 'string'
    OR (claim->>'token') !~ '^[a-f0-9]{{8}}-[a-f0-9]{{4}}-[a-f0-9]{{4}}-[a-f0-9]{{4}}-[a-f0-9]{{12}}$' THEN
    RAISE EXCEPTION 'existing payment claim acknowledgement refused' USING ERRCODE='42501';
  END IF;
  token:=(claim->>'token')::uuid;
  outcome:=prefunded_card.project('{OPERATION}','{SYSTEM}');
  IF outcome IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'existing payment project acknowledgement refused' USING ERRCODE='42501';
  END IF;
  finished:=prefunded_card.finish_dispatch('{OPERATION}',token,'{SYSTEM}');
  IF finished IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'existing payment finish acknowledgement refused' USING ERRCODE='42501';
  END IF;
END $projection$;
SET CONSTRAINTS ALL IMMEDIATE;
RESET SESSION AUTHORIZATION;
{deadline_sql()}
DO $postcondition$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM prefunded_card.dispatch_queue queue
    CROSS JOIN prefunded_card.treasury_bindings binding
    CROSS JOIN pg_temp.existing_payment_projection_before baseline
    WHERE queue.operation_id='{OPERATION}' AND queue.attempts=baseline.attempts+1
      AND queue.claim_token IS NULL AND queue.lease_expires_at IS NULL
      AND queue.finished_at IS NOT NULL AND queue.finished_at<'{DEADLINE}'::timestamptz
      AND (to_jsonb(queue)-ARRAY['attempts','claim_token','lease_expires_at','finished_at','available_at'])
        = (baseline.queue_before-ARRAY['attempts','claim_token','lease_expires_at','finished_at','available_at'])
      AND binding.id='{scope['treasuryBindingId']}' AND to_jsonb(binding)=baseline.treasury) THEN
    RAISE EXCEPTION 'existing payment queue or treasury changed' USING ERRCODE='42501';
  END IF;
END $postcondition$;
"""
