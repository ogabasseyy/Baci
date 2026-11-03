-- PiggyVest S6: cancel a savings goal and refund the whole balance, interest
-- included, to the customer's main wallet (dark: behind the existing
-- PiggyVest flags; the cancel path itself ignores flags and the kill switch).
--
-- PiggyVest is the system of record, so the amount moved is the goal wallet
-- balance PiggyVest reports at the moment of dispatch (the caller passes it
-- in; we never compute interest). This migration only records the attempt
-- and the settlement.
--
--  * goal_cancel_operations: one row per cancel ATTEMPT. The operation id is
--    issued here (issue_goal_cancel) before any PIN is typed, so the PIN
--    proof can be bound to it. The provider reference is per goal and action
--    ('pvb-cancel-<goalId>'), never per attempt, so a retry or double tap can
--    not move money twice at the provider. At most one attempt per goal may be
--    reserved, dispatched or confirmed (partial unique index).
--  * reserve_goal_cancel_with_pin: spends the goal_cancel PIN proof in the
--    SAME transaction as the reservation. The proof binds
--    sha256('<goalId>:cancel:<operationId>') with the fixed 1 kobo marker; the
--    operation id must be a row this database issued for this goal and
--    customer, so a caller-chosen id can never be spent against.
--  * manage_goal_cancel: dispatch (records the provider balance as the
--    amount), cancel / cancel_stale (nothing was sent) and release (the
--    provider definitively rejected and no transfer exists).
--  * settle_goal_cancel / release_failed_goal_cancel: evidence-role
--    settlement from a verified provider record. Settling marks the attempt
--    confirmed and the goal cancelled in one transaction.
--  * A trigger on savings_operations stops a funding reservation for a goal
--    that has a cancel in flight or done, so money cannot be added mid-cancel.
--
-- The executor login gets EXECUTE on the new cancel wrapper only.
-- consume_goal_pin_proof stays revoked from it (S7 re-grants for complete).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE piggyvest_primary.goal_cancel_operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('issued', 'reserved', 'dispatched', 'confirmed', 'released')),
  reference text NOT NULL CHECK (reference = 'pvb-cancel-' || goal_id::text),
  source_wallet_id text,
  destination_wallet_id text,
  amount_kobo bigint CHECK (amount_kobo IS NULL OR amount_kobo BETWEEN 1 AND 9999999999),
  provider_transaction_id text,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  dispatched_at timestamptz,
  settled_at timestamptz,
  CHECK (state = 'issued' OR state = 'released' OR (
    source_wallet_id IS NOT NULL AND destination_wallet_id IS NOT NULL
    AND source_wallet_id <> destination_wallet_id)),
  CHECK (state NOT IN ('dispatched', 'confirmed') OR amount_kobo IS NOT NULL),
  CHECK (state <> 'confirmed' OR provider_transaction_id IS NOT NULL)
);
CREATE UNIQUE INDEX goal_cancel_one_live_per_goal_idx
  ON piggyvest_primary.goal_cancel_operations (goal_id)
  WHERE state IN ('reserved', 'dispatched', 'confirmed');
CREATE UNIQUE INDEX goal_cancel_provider_transaction_idx
  ON piggyvest_primary.goal_cancel_operations (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX goal_cancel_integration_idx ON piggyvest_primary.goal_cancel_operations (integration_id);
CREATE INDEX goal_cancel_intent_idx ON piggyvest_primary.goal_cancel_operations (intent_id);
CREATE INDEX goal_cancel_goal_state_idx ON piggyvest_primary.goal_cancel_operations (goal_id, state);

ALTER TABLE piggyvest_primary.goal_cancel_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_cancel_operations_deny ON piggyvest_primary.goal_cancel_operations
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.goal_cancel_operations
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- Issues (or returns the live) server operation id for one cancel attempt.
CREATE FUNCTION piggyvest_primary.issue_goal_cancel(scope jsonb, goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF scope IS NULL OR goal_id IS NULL THEN
    RAISE EXCEPTION 'invalid goal cancel request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = issue_goal_cancel.goal_id
     AND goal.customer_id = (scope ->> 'customerId')::uuid
     AND goal.merchant_id = (scope ->> 'merchantId')::uuid
     AND goal.status IN ('active', 'paused')
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM piggyvest_primary.savings_destinations AS destination
   WHERE destination.integration_id = (scope ->> 'integrationId')::uuid
     AND destination.goal_id = v_goal.id AND destination.intent_id = v_intent_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings destination unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT live.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS live
   WHERE live.goal_id = v_goal.id AND live.state IN ('reserved', 'dispatched')
     FOR UPDATE;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending', 'operationId', v_operation.id);
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_goal.id AND funding.state IN ('reserved', 'dispatched')) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  -- The clock is read after every lock above has been acquired.
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.goal_cancel_operations AS stale SET state = 'released'
   WHERE stale.goal_id = v_goal.id AND stale.state = 'issued' AND stale.expires_at <= v_now;
  SELECT fresh.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS fresh
   WHERE fresh.goal_id = v_goal.id AND fresh.state = 'issued' AND fresh.expires_at > v_now
   ORDER BY fresh.issued_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO piggyvest_primary.goal_cancel_operations
      (id, integration_id, intent_id, goal_id, state, reference, issued_at, expires_at)
    VALUES (pg_catalog.gen_random_uuid(), (scope ->> 'integrationId')::uuid, v_intent_id,
      v_goal.id, 'issued', 'pvb-cancel-' || v_goal.id::text, v_now, v_now + interval '10 minutes')
    RETURNING * INTO v_operation;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'issued', 'operationId', v_operation.id, 'expiresAt', v_operation.expires_at);
END;
$$;

-- Reserves the attempt and spends the goal_cancel PIN proof in one transaction.
CREATE FUNCTION piggyvest_primary.reserve_goal_cancel_with_pin(
  scope jsonb,
  request jsonb,
  pin_proof text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_valid boolean;
  v_goal_id uuid;
  v_operation_id uuid;
  v_customer_id uuid;
  v_merchant_id uuid;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_destination piggyvest_primary.savings_destinations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_outcome text;
  v_now timestamptz;
BEGIN
  v_valid := CASE
    WHEN request IS NOT NULL AND pg_catalog.jsonb_typeof(request) = 'object' THEN
      (request ?& ARRAY['goalId', 'operationId']) IS TRUE
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) = 2
      AND pg_catalog.jsonb_typeof(request -> 'goalId') = 'string'
      AND pg_catalog.jsonb_typeof(request -> 'operationId') = 'string'
    ELSE false END;
  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid goal cancel request' USING ERRCODE = '22023';
  END IF;
  v_goal_id := (request ->> 'goalId')::uuid;
  v_operation_id := (request ->> 'operationId')::uuid;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  v_customer_id := (scope ->> 'customerId')::uuid;
  v_merchant_id := (scope ->> 'merchantId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  -- Server provenance: only an operation this database issued, for this
  -- integration, customer intent and goal, can be reserved or spent against.
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = v_operation_id AND op.integration_id = (scope ->> 'integrationId')::uuid
     AND op.intent_id = v_intent_id AND op.goal_id = v_goal_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;
  IF v_operation.state = 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'confirmed');
  ELSIF v_operation.state IN ('reserved', 'dispatched') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending');
  ELSIF v_operation.state <> 'issued' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;
  -- Clock read after the locks: an operation id past its expiry is dead.
  v_now := pg_catalog.clock_timestamp();
  IF v_operation.expires_at <= v_now THEN
    UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object('status', 'expired');
  END IF;
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_goal_id AND goal.customer_id = v_customer_id
     AND goal.merchant_id = v_merchant_id AND goal.status IN ('active', 'paused')
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT destination.* INTO v_destination FROM piggyvest_primary.savings_destinations AS destination
   WHERE destination.integration_id = v_operation.integration_id
     AND destination.goal_id = v_goal.id AND destination.intent_id = v_intent_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings destination unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_intent_id;
  IF v_intent.provider_wallet_id IS NULL OR v_intent.provider_customer_id IS NULL
    OR v_intent.provider_wallet_id = v_destination.provider_wallet_id THEN
    RAISE EXCEPTION 'savings wallets unavailable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_goal.id AND funding.state IN ('reserved', 'dispatched')) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  BEGIN
    v_outcome := wallet_pin_private.consume_wallet_pin_proof(
      v_customer_id, v_merchant_id, 'goal_cancel', 1,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        v_goal.id::text || ':cancel:' || v_operation.id::text, 'UTF8')), 'hex'),
      pin_proof);
    IF v_outcome IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'pin_refused:%', COALESCE(v_outcome, 'invalid') USING ERRCODE = 'PVP01';
    END IF;
    UPDATE piggyvest_primary.goal_cancel_operations
       SET state = 'reserved', reserved_at = pg_catalog.clock_timestamp(),
           source_wallet_id = v_destination.provider_wallet_id,
           destination_wallet_id = v_intent.provider_wallet_id
     WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'claimed',
      'reservation', pg_catalog.jsonb_build_object(
        'operationId', v_operation.id, 'goalId', v_goal.id,
        'sourceWalletId', v_destination.provider_wallet_id,
        'destinationWalletId', v_intent.provider_wallet_id,
        'reference', v_operation.reference,
        'businessId', scope ->> 'businessId',
        'providerCustomerId', v_intent.provider_customer_id));
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    -- Leaving the block rolled the reservation back; the issued id stays usable.
    RETURN pg_catalog.jsonb_build_object(
      'status', 'pin_refused',
      'reason', pg_catalog.replace(SQLERRM, 'pin_refused:', ''));
  END;
END;
$$;

-- dispatch: reserved -> dispatched and records the provider balance as the
-- amount. cancel / cancel_stale: reserved -> released (nothing was sent).
-- release: dispatched -> released (definitive rejection, no transfer found).
CREATE FUNCTION piggyvest_primary.manage_goal_cancel(
  scope jsonb,
  operation_id uuid,
  action text,
  amount_kobo bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF operation_id IS NULL OR action IS NULL
    OR action NOT IN ('dispatch', 'cancel', 'cancel_stale', 'release') THEN
    RAISE EXCEPTION 'invalid goal cancel transition' USING ERRCODE = '22023';
  END IF;
  IF action = 'dispatch' AND (amount_kobo IS NULL OR amount_kobo NOT BETWEEN 1 AND 9999999999) THEN
    RAISE EXCEPTION 'invalid goal cancel amount' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = manage_goal_cancel.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_now := pg_catalog.clock_timestamp();
  IF action = 'release' THEN
    IF v_operation.state <> 'dispatched' THEN RETURN false; END IF;
    UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN true;
  END IF;
  IF v_operation.state <> 'reserved' THEN RETURN false; END IF;
  IF action = 'cancel_stale' AND v_operation.reserved_at >= v_now - interval '5 minutes' THEN
    RETURN false;
  END IF;
  IF action <> 'dispatch' THEN
    UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN true;
  END IF;
  -- Dispatch re-checks scope and the goal at the transition.
  PERFORM 1
    FROM public.customer_savings_goals AS goal
    JOIN piggyvest_primary.savings_destinations AS destination
      ON destination.goal_id = goal.id AND destination.integration_id = v_operation.integration_id
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = destination.intent_id
   WHERE goal.id = v_operation.goal_id
     AND goal.customer_id = (scope ->> 'customerId')::uuid
     AND goal.merchant_id = (scope ->> 'merchantId')::uuid
     AND goal.status IN ('active', 'paused')
     AND destination.intent_id = v_operation.intent_id
     AND destination.provider_wallet_id = v_operation.source_wallet_id
     AND intent.provider_wallet_id = v_operation.destination_wallet_id
     FOR SHARE OF goal, destination, intent;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_operation.goal_id AND funding.state IN ('reserved', 'dispatched')) THEN
    RETURN false;
  END IF;
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = 'dispatched', amount_kobo = manage_goal_cancel.amount_kobo,
         dispatched_at = pg_catalog.clock_timestamp()
   WHERE id = v_operation.id;
  RETURN true;
END;
$$;

CREATE FUNCTION piggyvest_primary.read_goal_cancel_status(scope jsonb, operation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_state text;
BEGIN
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT op.state INTO v_state FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = read_goal_cancel_status.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid;
  RETURN v_state;
END;
$$;

-- Evidence role: the dispatched attempt as a reservation, for the provider re-query.
CREATE FUNCTION piggyvest_primary.read_dispatched_goal_cancel(
  integration_id uuid,
  environment text,
  operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation jsonb;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = read_dispatched_goal_cancel.integration_id
     AND binding.environment = read_dispatched_goal_cancel.environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
      'operationId', op.id, 'goalId', op.goal_id, 'amountKobo', op.amount_kobo,
      'sourceWalletId', op.source_wallet_id, 'destinationWalletId', op.destination_wallet_id,
      'reference', op.reference, 'businessId', binding.business_id,
      'providerCustomerId', intent.provider_customer_id)
    INTO v_reservation
    FROM piggyvest_primary.goal_cancel_operations AS op
    JOIN piggyvest_primary.integrations AS binding ON binding.id = op.integration_id
    JOIN piggyvest_primary.onboarding_intents AS intent
      ON intent.id = op.intent_id AND intent.integration_id = binding.id
    JOIN public.customers AS customer
      ON customer.id = intent.customer_id AND customer.merchant_id = intent.merchant_id
     AND customer.user_id = intent.user_id
   WHERE op.id = read_dispatched_goal_cancel.operation_id
     AND op.integration_id = read_dispatched_goal_cancel.integration_id
     AND op.state = 'dispatched' AND intent.state IN ('accepted', 'verified')
     AND intent.provider_wallet_id = op.destination_wallet_id;
  RETURN v_reservation;
END;
$$;

-- Shared shape check for a settlement / release proof (all 7 keys required).
CREATE FUNCTION piggyvest_primary.goal_cancel_proof_valid(proof jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(CASE
    WHEN proof IS NOT NULL AND pg_catalog.jsonb_typeof(proof) = 'object' THEN
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(proof)) = 7
      AND (proof ?& ARRAY['operationId', 'providerTransactionId', 'reference', 'amountKobo',
                          'sourceWalletId', 'destinationWalletId', 'businessId']) IS TRUE
      AND pg_catalog.jsonb_typeof(proof -> 'amountKobo') = 'number'
      AND COALESCE(proof ->> 'amountKobo', '') ~ '^[1-9][0-9]*$'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(proof) AS field
         WHERE field.key <> 'amountKobo'
           AND (pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string'
                OR pg_catalog.octet_length(field.value #>> '{}') NOT BETWEEN 1 AND 512))
    ELSE false END, false);
$$;

-- Settles the attempt from a verified successful provider record: the attempt
-- is confirmed and the goal is cancelled in one transaction.
CREATE FUNCTION piggyvest_primary.settle_goal_cancel(
  integration_id uuid,
  environment text,
  proof jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = settle_goal_cancel.integration_id
     AND candidate.environment = settle_goal_cancel.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_cancel_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = v_operation.id FOR UPDATE;
  SELECT candidate.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS candidate
    JOIN public.customers AS customer
      ON customer.id = candidate.customer_id AND customer.merchant_id = candidate.merchant_id
     AND customer.user_id = candidate.user_id
   WHERE candidate.id = v_operation.intent_id AND candidate.integration_id = v_binding.id
     AND candidate.state IN ('accepted', 'verified')
     FOR SHARE OF candidate, customer;
  IF NOT FOUND
    OR v_intent.provider_wallet_id IS DISTINCT FROM v_operation.destination_wallet_id
    OR v_operation.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_operation.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_operation.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_operation.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_operation.state = 'confirmed' THEN
    IF v_operation.provider_transaction_id = proof ->> 'providerTransactionId' THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;
  IF v_operation.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                WHERE funding.integration_id = v_binding.id
                  AND funding.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  -- The clock is read after the locks, so the action time is the transition.
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = 'confirmed', provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = v_now
   WHERE id = v_operation.id;
  -- The refund has reached the main wallet, so the goal no longer holds money.
  -- A goal row that is gone or already spent does not undo a settled transfer.
  UPDATE public.customer_savings_goals AS goal
     SET status = 'cancelled', cancelled_at = v_now, future_debits_cancelled_at = COALESCE(goal.future_debits_cancelled_at, v_now),
         current_amount = 0, updated_at = v_now
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id AND goal.status <> 'spent';
  IF FOUND THEN
    INSERT INTO public.customer_savings_events
      (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
    VALUES (v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
      'goal_cancelled_refunded', 'system',
      pg_catalog.jsonb_build_object('operation_id', v_operation.id, 'amount_kobo', v_operation.amount_kobo));
  END IF;
  RETURN 'confirmed';
END;
$$;

-- A provider record showing the transfer FAILED releases the attempt.
CREATE FUNCTION piggyvest_primary.release_failed_goal_cancel(
  integration_id uuid,
  environment text,
  proof jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = release_failed_goal_cancel.integration_id
     AND candidate.environment = release_failed_goal_cancel.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_cancel_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS candidate
   WHERE candidate.id = v_operation.id FOR UPDATE;
  SELECT candidate.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS candidate
    JOIN public.customers AS customer
      ON customer.id = candidate.customer_id AND customer.merchant_id = candidate.merchant_id
     AND customer.user_id = candidate.user_id
   WHERE candidate.id = v_operation.intent_id AND candidate.integration_id = v_binding.id
     AND candidate.state IN ('accepted', 'verified')
     FOR SHARE OF candidate, customer;
  IF NOT FOUND
    OR v_intent.provider_wallet_id IS DISTINCT FROM v_operation.destination_wallet_id
    OR v_operation.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_operation.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_operation.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_operation.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR v_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN 'conflict';
  END IF;
  IF v_operation.state = 'released' THEN RETURN 'duplicate'; END IF;
  IF v_operation.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
  RETURN 'released';
END;
$$;

-- Funding may not be reserved for a goal whose cancel is in flight or done.
CREATE FUNCTION piggyvest_primary.block_funding_during_goal_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS cancel
     WHERE cancel.goal_id = NEW.goal_id AND cancel.state IN ('reserved', 'dispatched', 'confirmed')) THEN
    RAISE EXCEPTION 'savings goal is being cancelled' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER block_funding_during_goal_cancel
  BEFORE INSERT ON piggyvest_primary.savings_operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_funding_during_goal_cancel();

REVOKE ALL ON FUNCTION
  piggyvest_primary.issue_goal_cancel(jsonb, uuid),
  piggyvest_primary.reserve_goal_cancel_with_pin(jsonb, jsonb, text),
  piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint),
  piggyvest_primary.read_goal_cancel_status(jsonb, uuid),
  piggyvest_primary.read_dispatched_goal_cancel(uuid, text, uuid),
  piggyvest_primary.goal_cancel_proof_valid(jsonb),
  piggyvest_primary.settle_goal_cancel(uuid, text, jsonb),
  piggyvest_primary.release_failed_goal_cancel(uuid, text, jsonb),
  piggyvest_primary.block_funding_during_goal_cancel()
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

GRANT EXECUTE ON FUNCTION piggyvest_primary.issue_goal_cancel(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_goal_cancel_with_pin(jsonb, jsonb, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_cancel_status(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_dispatched_goal_cancel(uuid, text, uuid)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_cancel(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_goal_cancel(uuid, text, jsonb)
  TO piggyvest_primary_evidence;

COMMIT;
