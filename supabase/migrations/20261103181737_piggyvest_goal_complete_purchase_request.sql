-- PiggyVest S7: complete a savings goal. The goal's FULL PiggyVest balance,
-- interest included, moves to the customer's main wallet, the goal is marked
-- completed, and a durable purchase request is saved BEFORE the owner is
-- alerted, so a failed alert loses nothing. The owner fulfils the purchase by
-- hand: there is no checkout, no wallet spend and no bank payout here.
-- Dark: behind the existing PiggyVest flags; like cancel, complete ignores the
-- flags and the master kill switch (it only returns the customer's own money
-- to their own main wallet) and has its own off switch in the application.
--
-- ONE migration on purpose (a half-applied schema is worse than a long file).
-- It mirrors the S6 goal cancel schema (20261103085004); S6 is shipped and
-- append-only, so nothing there is edited. Sections, in order:
--   1. goal_complete_operations, goal_purchase_requests (tables, RLS)
--   2. goal_complete_eligible / goal_cancel_in_flight helpers
--   3. issue / reserve-with-PIN / manage / status / read-dispatched
--   4. settle / release / operator review clearance (+ public wrapper)
--   5. fences: funding, redemption, deletion, and cancel-versus-complete
--   6. purchase request alert state (evidence role) and operator wrappers
--   7. funding availability and daily reconciliation count settled completions
--   8. grants
--
-- Rules carried over from S6 (each cost a review round there):
--  * The operation id is issued by the server before any PIN is typed; the
--    PIN proof binds sha256('<goalId>:complete:<operationId>') with the fixed
--    1 kobo marker and is spent in the SAME transaction as the reservation.
--  * Provider references are never reused ('pvb-complete-<goalId>', then
--    '-<n>' one above the highest ever issued; UNIQUE).
--  * Settlement, the local main-wallet credit, the goal completion and the
--    purchase request are ONE transaction. A residual provider balance, or
--    funding after a late dispatch, records needs_review: only the transfer's
--    own amount is credited, the goal stays open, no purchase request exists,
--    and an operator clears it through the service-role wrapper.
--  * Complete is allowed only when the goal reached its target (status
--    completed, or current amount >= target) or its maturity date, never for
--    a goal that also holds legacy contributions or order redemptions.
--  * Target or maturity is judged under the goal lock at issue, at
--    reservation (before the PIN is spent) and at dispatch.
--  * consume_goal_pin_proof stays revoked from the executor login. The only
--    new spend point is reserve_goal_complete_with_pin, which hashes the
--    binding itself from a server-issued operation id (never a caller value).
--  * Daily reconciliation expects greatest(0, funding - settled refunds -
--    settled completions).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE piggyvest_primary.goal_complete_operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN (
    'issued', 'reserved', 'dispatched', 'confirmed', 'released', 'needs_review', 'reviewed')),
  -- NULL until the attempt is reserved (an issued or expired id has no
  -- provider reference), then fixed for good and unique.
  reference text CHECK (
    reference IS NULL
    OR reference = 'pvb-complete-' || goal_id::text
    OR reference ~ ('^pvb-complete-' || goal_id::text || '-[1-9][0-9]{0,5}$')),
  source_wallet_id text,
  destination_wallet_id text,
  amount_kobo bigint CHECK (amount_kobo IS NULL OR amount_kobo BETWEEN 1 AND 9999999999),
  provider_transaction_id text,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  dispatched_at timestamptz,
  settled_at timestamptz,
  review_note text,
  reviewed_at timestamptz,
  CONSTRAINT goal_complete_reference_key UNIQUE (reference),
  CHECK (state = 'issued' OR state = 'released' OR (
    source_wallet_id IS NOT NULL AND destination_wallet_id IS NOT NULL
    AND source_wallet_id <> destination_wallet_id)),
  -- A NULL reference is only legal for an attempt that was never reserved.
  CHECK (reference IS NOT NULL OR reserved_at IS NULL),
  CHECK (state IN ('issued', 'released') OR reference IS NOT NULL),
  CHECK (state NOT IN ('dispatched', 'confirmed', 'needs_review', 'reviewed')
         OR amount_kobo IS NOT NULL),
  CHECK (state NOT IN ('confirmed', 'needs_review', 'reviewed')
         OR provider_transaction_id IS NOT NULL),
  CHECK (state <> 'reviewed' OR (review_note IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX goal_complete_one_live_per_goal_idx
  ON piggyvest_primary.goal_complete_operations (goal_id)
  WHERE state IN ('reserved', 'dispatched', 'confirmed', 'needs_review');
CREATE UNIQUE INDEX goal_complete_provider_transaction_idx
  ON piggyvest_primary.goal_complete_operations (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX goal_complete_integration_idx ON piggyvest_primary.goal_complete_operations (integration_id);
CREATE INDEX goal_complete_intent_idx ON piggyvest_primary.goal_complete_operations (intent_id);
CREATE INDEX goal_complete_goal_state_idx ON piggyvest_primary.goal_complete_operations (goal_id, state);

ALTER TABLE piggyvest_primary.goal_complete_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_complete_operations_deny ON piggyvest_primary.goal_complete_operations
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.goal_complete_operations
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- One purchase request per settled completion. It is written inside
-- settle_goal_complete, so it exists before any alert can be sent. The alert
-- state (alerted_at) is separate: a failed alert leaves the row and the
-- operator wrapper below lists it.
CREATE TABLE piggyvest_primary.goal_purchase_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  complete_operation_id uuid NOT NULL
    REFERENCES piggyvest_primary.goal_complete_operations(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  goal_title text NOT NULL CHECK (pg_catalog.char_length(goal_title) BETWEEN 1 AND 500),
  target_amount numeric(12, 2) NOT NULL CHECK (target_amount > 0),
  product_id uuid,
  variant_id uuid,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'fulfilled')),
  created_at timestamptz NOT NULL,
  alerted_at timestamptz,
  fulfilled_at timestamptz,
  fulfilment_note text,
  CONSTRAINT goal_purchase_requests_operation_key UNIQUE (complete_operation_id),
  CHECK (state <> 'fulfilled' OR (fulfilled_at IS NOT NULL AND fulfilment_note IS NOT NULL))
);
CREATE INDEX goal_purchase_requests_integration_idx
  ON piggyvest_primary.goal_purchase_requests (integration_id);
CREATE INDEX goal_purchase_requests_open_idx
  ON piggyvest_primary.goal_purchase_requests (created_at)
  WHERE state = 'open';
ALTER TABLE piggyvest_primary.goal_purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_purchase_requests_deny ON piggyvest_primary.goal_purchase_requests
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.goal_purchase_requests
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- True only when the goal may be completed now: it reached its target (status
-- completed, or the current amount covers the target) or its maturity date.
-- VOLATILE on purpose: it reads the clock, and callers invoke it after every
-- lock so the answer is the state at the transition. A missing goal is false.
CREATE FUNCTION piggyvest_primary.goal_complete_eligible(p_goal_id uuid)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT goal.status IN ('active', 'paused', 'completed')
        AND (goal.status = 'completed'
             OR goal.current_amount >= goal.target_amount
             OR goal.maturity_date <= (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date)
       FROM public.customer_savings_goals AS goal
      WHERE goal.id = p_goal_id),
    false);
$$;

-- True when a cancel attempt for the goal is reserved, dispatched, confirmed
-- or waiting for an operator: complete and cancel never run for one goal.
-- Null input or a read problem counts as in flight (fail closed).
CREATE FUNCTION piggyvest_primary.goal_cancel_in_flight(p_goal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS cancel
             WHERE cancel.goal_id = p_goal_id
               AND cancel.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')),
    true);
$$;


-- Issues (or returns the live) server operation id for one complete attempt.
CREATE FUNCTION piggyvest_primary.issue_goal_complete(scope jsonb, goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF scope IS NULL OR goal_id IS NULL THEN
    RAISE EXCEPTION 'invalid goal complete request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = issue_goal_complete.goal_id
     AND goal.customer_id = (scope ->> 'customerId')::uuid
     AND goal.merchant_id = (scope ->> 'merchantId')::uuid
     AND goal.status IN ('active', 'paused', 'completed')
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
  SELECT live.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS live
   WHERE live.goal_id = v_goal.id AND live.state IN ('reserved', 'dispatched')
     FOR UPDATE;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending', 'operationId', v_operation.id);
  END IF;
  -- A goal that was already completed answers with its settled attempt.
  SELECT done.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS done
   WHERE done.goal_id = v_goal.id AND done.state = 'confirmed';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'confirmed', 'operationId', v_operation.id);
  END IF;
  -- An attempt waiting for an operator blocks a new complete until it is cleared.
  IF piggyvest_primary.goal_cancel_needs_review(v_goal.id) IS NOT FALSE
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS review
                WHERE review.goal_id = v_goal.id AND review.state = 'needs_review') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  END IF;
  -- Target or maturity is judged here, under the goal lock, at issue time.
  IF piggyvest_primary.goal_complete_eligible(v_goal.id) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_eligible');
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_goal.id AND funding.state IN ('reserved', 'dispatched'))
    OR piggyvest_primary.goal_cancel_in_flight(v_goal.id) IS NOT FALSE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  UPDATE piggyvest_primary.goal_complete_operations AS stale SET state = 'released'
   WHERE stale.goal_id = v_goal.id AND stale.state = 'issued'
     AND stale.expires_at <= pg_catalog.clock_timestamp();
  -- The clock is read after every lock above (including the row locks the
  -- update just took) has been acquired.
  v_now := pg_catalog.clock_timestamp();
  SELECT fresh.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS fresh
   WHERE fresh.goal_id = v_goal.id AND fresh.state = 'issued' AND fresh.expires_at > v_now
     AND fresh.integration_id = (scope ->> 'integrationId')::uuid AND fresh.intent_id = v_intent_id
   ORDER BY fresh.issued_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO piggyvest_primary.goal_complete_operations
      (id, integration_id, intent_id, goal_id, state, issued_at, expires_at)
    VALUES (pg_catalog.gen_random_uuid(), (scope ->> 'integrationId')::uuid, v_intent_id,
      v_goal.id, 'issued', v_now, v_now + interval '10 minutes')
    RETURNING * INTO v_operation;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'issued', 'operationId', v_operation.id, 'expiresAt', v_operation.expires_at);
END;
$$;

-- Reserves the attempt and spends the goal_complete PIN proof in one transaction.
CREATE FUNCTION piggyvest_primary.reserve_goal_complete_with_pin(
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
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_destination piggyvest_primary.savings_destinations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_outcome text;
  v_now timestamptz;
  v_highest integer;
BEGIN
  v_valid := CASE
    WHEN request IS NOT NULL AND pg_catalog.jsonb_typeof(request) = 'object' THEN
      (request ?& ARRAY['goalId', 'operationId']) IS TRUE
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(request)) = 2
      AND pg_catalog.jsonb_typeof(request -> 'goalId') = 'string'
      AND pg_catalog.jsonb_typeof(request -> 'operationId') = 'string'
    ELSE false END;
  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid goal complete request' USING ERRCODE = '22023';
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
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.id = v_operation_id AND op.integration_id = (scope ->> 'integrationId')::uuid
     AND op.intent_id = v_intent_id AND op.goal_id = v_goal_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;
  IF v_operation.state = 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'confirmed');
  ELSIF v_operation.state = 'needs_review' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  ELSIF v_operation.state IN ('reserved', 'dispatched') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending');
  ELSIF v_operation.state <> 'issued' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_goal_id AND goal.customer_id = v_customer_id
     AND goal.merchant_id = v_merchant_id AND goal.status IN ('active', 'paused', 'completed')
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
  -- The clock is read only now, after the intent, operation, goal and
  -- destination locks: an operation id past its expiry is dead, and the lock
  -- waits above can not make an expired id look live.
  v_now := pg_catalog.clock_timestamp();
  IF v_operation.expires_at <= v_now THEN
    UPDATE piggyvest_primary.goal_complete_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object('status', 'expired');
  END IF;
  -- Re-checked here, under the goal lock, before any PIN proof is spent.
  IF piggyvest_primary.goal_cancel_needs_review(v_goal.id) IS NOT FALSE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  END IF;
  -- Target or maturity is re-judged after the locks and before any PIN proof
  -- is spent: an issued id never outlives the goal's eligibility.
  IF piggyvest_primary.goal_complete_eligible(v_goal.id) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_eligible');
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_goal.id AND funding.state IN ('reserved', 'dispatched'))
    OR piggyvest_primary.goal_cancel_in_flight(v_goal.id) IS NOT FALSE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  BEGIN
    v_outcome := wallet_pin_private.consume_wallet_pin_proof(
      v_customer_id, v_merchant_id, 'goal_complete', 1,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        v_goal.id::text || ':complete:' || v_operation.id::text, 'UTF8')), 'hex'),
      pin_proof);
    IF v_outcome IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'pin_refused:%', COALESCE(v_outcome, 'invalid') USING ERRCODE = 'PVP01';
    END IF;
    -- The reference is fixed here, under the intent and goal locks, and is
    -- NEVER reused: the suffix is one more than the highest suffix ever
    -- issued for this goal, in any state (the bare reference counts as 0).
    -- The provider may keep a record under any earlier reference, so only a
    -- fresh one is safe; the UNIQUE constraint backs this up.
    SELECT COALESCE(pg_catalog.max(CASE
             WHEN issued.reference = 'pvb-complete-' || v_goal.id::text THEN 0
             ELSE pg_catalog.substr(issued.reference,
                    pg_catalog.char_length('pvb-complete-' || v_goal.id::text) + 2)::integer
           END), -1)
      INTO v_highest
      FROM piggyvest_primary.goal_complete_operations AS issued
     WHERE issued.goal_id = v_goal.id AND issued.reference IS NOT NULL;
    UPDATE piggyvest_primary.goal_complete_operations
       SET state = 'reserved', reserved_at = pg_catalog.clock_timestamp(),
           source_wallet_id = v_destination.provider_wallet_id,
           destination_wallet_id = v_intent.provider_wallet_id,
           reference = 'pvb-complete-' || v_goal.id::text
             || CASE WHEN v_highest < 0 THEN '' ELSE '-' || (v_highest + 1)::text END
     WHERE id = v_operation.id
     RETURNING * INTO v_operation;
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
CREATE FUNCTION piggyvest_primary.manage_goal_complete(
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
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF operation_id IS NULL OR action IS NULL
    OR action NOT IN ('dispatch', 'cancel', 'cancel_stale', 'release') THEN
    RAISE EXCEPTION 'invalid goal complete transition' USING ERRCODE = '22023';
  END IF;
  IF action = 'dispatch' AND (amount_kobo IS NULL OR amount_kobo NOT BETWEEN 1 AND 9999999999) THEN
    RAISE EXCEPTION 'invalid goal complete amount' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.id = manage_goal_complete.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_now := pg_catalog.clock_timestamp();
  IF action = 'release' THEN
    IF v_operation.state <> 'dispatched' THEN RETURN false; END IF;
    UPDATE piggyvest_primary.goal_complete_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN true;
  END IF;
  IF v_operation.state <> 'reserved' THEN RETURN false; END IF;
  IF action = 'cancel_stale' AND v_operation.reserved_at >= v_now - interval '5 minutes' THEN
    RETURN false;
  END IF;
  IF action <> 'dispatch' THEN
    UPDATE piggyvest_primary.goal_complete_operations SET state = 'released' WHERE id = v_operation.id;
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
     AND goal.status IN ('active', 'paused', 'completed')
     AND destination.intent_id = v_operation.intent_id
     AND destination.provider_wallet_id = v_operation.source_wallet_id
     AND intent.provider_wallet_id = v_operation.destination_wallet_id
     FOR SHARE OF goal, destination, intent;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_operation.goal_id AND funding.state IN ('reserved', 'dispatched'))
    OR piggyvest_primary.goal_cancel_needs_review(v_operation.goal_id) IS NOT FALSE
    OR piggyvest_primary.goal_complete_eligible(v_operation.goal_id) IS NOT TRUE
    OR piggyvest_primary.goal_cancel_in_flight(v_operation.goal_id) IS NOT FALSE THEN
    RETURN false;
  END IF;
  UPDATE piggyvest_primary.goal_complete_operations
     SET state = 'dispatched', amount_kobo = manage_goal_complete.amount_kobo,
         dispatched_at = pg_catalog.clock_timestamp()
   WHERE id = v_operation.id;
  RETURN true;
END;
$$;

CREATE FUNCTION piggyvest_primary.read_goal_complete_status(scope jsonb, operation_id uuid)
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
  SELECT op.state INTO v_state FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.id = read_goal_complete_status.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid;
  RETURN v_state;
END;
$$;

-- Evidence role: the dispatched attempt as a reservation, for the provider re-query.
-- A released attempt that WAS dispatched is returned too: the provider may
-- index the transfer only after it was released, and that late success must
-- still be reachable from reconciliation.
CREATE FUNCTION piggyvest_primary.read_dispatched_goal_complete(
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
   WHERE binding.id = read_dispatched_goal_complete.integration_id
     AND binding.environment = read_dispatched_goal_complete.environment
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
    FROM piggyvest_primary.goal_complete_operations AS op
    JOIN piggyvest_primary.integrations AS binding ON binding.id = op.integration_id
    JOIN piggyvest_primary.onboarding_intents AS intent
      ON intent.id = op.intent_id AND intent.integration_id = binding.id
    JOIN public.customers AS customer
      ON customer.id = intent.customer_id AND customer.merchant_id = intent.merchant_id
     AND customer.user_id = intent.user_id
   WHERE op.id = read_dispatched_goal_complete.operation_id
     AND op.integration_id = read_dispatched_goal_complete.integration_id
     AND (op.state = 'dispatched' OR (op.state = 'released' AND op.dispatched_at IS NOT NULL))
     AND intent.state IN ('accepted', 'verified')
     AND intent.provider_wallet_id = op.destination_wallet_id;
  RETURN v_reservation;
END;
$$;

-- Shared shape check for a settlement / release proof (all 7 keys required).
CREATE FUNCTION piggyvest_primary.goal_complete_proof_valid(proof jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(CASE
    WHEN proof IS NOT NULL AND pg_catalog.jsonb_typeof(proof) = 'object' THEN
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(proof)) BETWEEN 7 AND 8
      AND (proof ?& ARRAY['operationId', 'providerTransactionId', 'reference', 'amountKobo',
                          'sourceWalletId', 'destinationWalletId', 'businessId']) IS TRUE
      AND pg_catalog.jsonb_typeof(proof -> 'amountKobo') = 'number'
      AND COALESCE(proof ->> 'amountKobo', '') ~ '^[1-9][0-9]*$'
      -- The optional eighth key is the goal wallet balance the caller re-read
      -- at the provider after the transfer. It can only make settlement
      -- stricter (review), never looser.
      AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(proof)) = 7
           OR (proof ? 'residualKobo'
               AND pg_catalog.jsonb_typeof(proof -> 'residualKobo') = 'number'
               AND COALESCE(proof ->> 'residualKobo', '') ~ '^[1-9][0-9]{0,9}$'))
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_each(proof) AS field
         WHERE field.key NOT IN ('amountKobo', 'residualKobo')
           AND (pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string'
                OR pg_catalog.octet_length(field.value #>> '{}') NOT BETWEEN 1 AND 512))
    ELSE false END, false);
$$;

-- Settles the attempt from a verified successful provider record: the attempt
-- is confirmed, the goal completed and the purchase request saved in one
-- transaction. A released
-- attempt that was dispatched also settles, because the provider may report
-- the transfer successful after it was released.
CREATE FUNCTION piggyvest_primary.settle_goal_complete(
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
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_now timestamptz;
  v_wallet_id uuid;
  v_wallet_balance numeric;
  v_late boolean := false;
  v_review boolean := false;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_goal_amount numeric;
  v_residual bigint := 0;
  v_target text;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = settle_goal_complete.integration_id
     AND candidate.environment = settle_goal_complete.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_complete_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
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
  IF v_operation.state IN ('confirmed', 'needs_review', 'reviewed') THEN
    IF v_operation.provider_transaction_id = proof ->> 'providerTransactionId' THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;
  IF v_operation.state = 'released' AND v_operation.dispatched_at IS NOT NULL THEN
    -- A late success: the provider indexed the transfer after it was released.
    -- The money has moved, so the verified record settles it, unless another
    -- attempt for the goal is already live.
    IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS live
                WHERE live.goal_id = v_operation.goal_id AND live.id <> v_operation.id
                  AND live.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')) THEN
      RETURN 'conflict';
    END IF;
    v_late := true;
  ELSIF v_operation.state <> 'dispatched' THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS cancel
                WHERE cancel.integration_id = v_binding.id
                  AND cancel.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                WHERE funding.integration_id = v_binding.id
                  AND funding.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  -- Every row this settlement writes is locked first, and each write reads
  -- the clock itself, so no timestamp predates a lock wait. The goal row is
  -- locked here for both the late check and the final update.
  v_residual := COALESCE((proof ->> 'residualKobo')::bigint, 0);
  SELECT goal.* INTO v_goal FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id FOR UPDATE;
  v_goal_amount := v_goal.current_amount;
  PERFORM 1 FROM public.customer_wallets AS wallet
   WHERE wallet.customer_id = v_intent.customer_id AND wallet.merchant_id = v_intent.merchant_id
     FOR UPDATE;
  -- A goal wallet that still holds money at the provider after the transfer
  -- (a credit landed between the balance snapshot and the transfer) is never
  -- settled as completed-at-zero. A late success settles ONLY its own amount:
  -- the goal may have been funded again after this attempt was released (the
  -- funding fence ignores released attempts), so when funding was reserved
  -- after the dispatch, or any local balance would remain once this refund is
  -- deducted, the attempt becomes 'needs_review'. The refund itself is still
  -- credited, the goal stays open, and the caller is told 'conflict' so an
  -- operator is paged.
  IF v_late THEN
    v_review := EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                         WHERE funding.goal_id = v_operation.goal_id
                           AND funding.state IN ('reserved', 'dispatched', 'confirmed')
                           AND funding.created_at >= v_operation.dispatched_at)
      OR COALESCE(v_goal_amount - v_operation.amount_kobo::numeric / 100, 0) > 0;
  END IF;
  -- A goal that is gone or no longer completable can not carry the purchase
  -- request, so the money is credited and the attempt goes to review instead
  -- of confirming a completion nobody can fulfil.
  v_review := v_review OR v_residual > 0
    OR COALESCE(v_goal.status NOT IN ('active', 'paused', 'completed'), true);
  v_target := CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END;
  UPDATE piggyvest_primary.goal_complete_operations
     SET state = v_target, provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_operation.id;
  -- The refund has reached the main wallet at the provider, so the local
  -- main-wallet ledger is credited in this same transaction (this branch runs
  -- once per attempt: the state check above returns duplicate for a replay).
  -- Only this refund's own amount is credited. The merchant guard on the
  -- conflict arm refuses a wallet row of another merchant instead of
  -- crediting it.
  INSERT INTO public.customer_wallets (customer_id, merchant_id, available_balance, total_earned)
  VALUES (v_intent.customer_id, v_intent.merchant_id, v_operation.amount_kobo::numeric / 100, 0)
  ON CONFLICT (customer_id) DO UPDATE SET
    available_balance = public.customer_wallets.available_balance + EXCLUDED.available_balance,
    updated_at = pg_catalog.clock_timestamp()
    WHERE public.customer_wallets.merchant_id = EXCLUDED.merchant_id
  RETURNING id, available_balance INTO v_wallet_id, v_wallet_balance;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'refund wallet unavailable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.customer_wallet_transactions
    (wallet_id, customer_id, merchant_id, type, status, amount, balance_after,
     source_type, source_id, description)
  VALUES (v_wallet_id, v_intent.customer_id, v_intent.merchant_id, 'refund', 'completed',
    v_operation.amount_kobo::numeric / 100, v_wallet_balance,
    'piggyvest_goal_complete', v_operation.id, 'Savings goal completed: moved to main wallet');
  -- The refund has reached the main wallet, so the goal no longer holds the
  -- refunded money. A goal row that is gone or already spent does not undo a
  -- settled transfer. Under review the goal stays open, drops by this refund's
  -- own amount ONLY. The provider residual is never booked here: a funding
  -- operation the provider already completed but that is not settled locally
  -- is part of that residual and is booked once, when it settles. The residual
  -- itself is left to the operator (needs_review).
  v_now := pg_catalog.clock_timestamp();
  UPDATE public.customer_savings_goals AS goal
     SET status = CASE WHEN v_review THEN goal.status ELSE 'completed' END,
         completed_at = CASE WHEN v_review THEN goal.completed_at ELSE COALESCE(goal.completed_at, v_now) END,
         future_debits_cancelled_at = CASE WHEN v_review THEN goal.future_debits_cancelled_at
           ELSE COALESCE(goal.future_debits_cancelled_at, v_now) END,
         current_amount = CASE
           WHEN v_review THEN GREATEST(0, goal.current_amount - v_operation.amount_kobo::numeric / 100)
           ELSE 0 END,
         updated_at = v_now
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id
     AND goal.status IN ('active', 'paused', 'completed');
  IF FOUND THEN
    INSERT INTO public.customer_savings_events
      (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
    VALUES (v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
      CASE WHEN v_review THEN 'goal_complete_needs_review' ELSE 'goal_completed_to_wallet' END, 'system',
      pg_catalog.jsonb_build_object('operation_id', v_operation.id, 'amount_kobo', v_operation.amount_kobo));
  END IF;
  IF v_review THEN RETURN 'conflict'; END IF;
  -- The purchase request is saved in this same transaction as the completion,
  -- so a settled completion always has its request and a failed save rolls the
  -- whole settlement back. The owner alert is sent only after this commits.
  INSERT INTO piggyvest_primary.goal_purchase_requests
    (complete_operation_id, integration_id, merchant_id, customer_id, goal_id, goal_title,
     target_amount, product_id, variant_id, amount_kobo, created_at)
  VALUES (v_operation.id, v_binding.id, v_intent.merchant_id, v_intent.customer_id, v_operation.goal_id,
    pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(v_goal.title), ''), 'Savings goal'), 500),
    v_goal.target_amount, v_goal.product_id, v_goal.variant_id, v_operation.amount_kobo, v_now);
  RETURN 'confirmed';
END;
$$;

-- A provider record showing the transfer FAILED releases the attempt.
CREATE FUNCTION piggyvest_primary.release_failed_goal_complete(
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
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = release_failed_goal_complete.integration_id
     AND candidate.environment = release_failed_goal_complete.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  IF piggyvest_primary.goal_complete_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
   WHERE candidate.id = (proof ->> 'operationId')::uuid AND candidate.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'conflict'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT candidate.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS candidate
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
  UPDATE piggyvest_primary.goal_complete_operations SET state = 'released' WHERE id = v_operation.id;
  RETURN 'released';
END;
$$;

-- Operator step out of review (ops tooling only, service role). Moves a
-- needs_review attempt to the terminal 'reviewed' state, which is outside the
-- live index, and records the note. After that the customer can complete again
-- and a fresh numbered reference sweeps whatever the provider still holds.
-- Returns true when an attempt was cleared, false when there was nothing to
-- clear (unknown id, or not in review).
CREATE FUNCTION piggyvest_primary.clear_goal_complete_review(p_operation_id uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation piggyvest_primary.goal_complete_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_note IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid goal complete review clearance' USING ERRCODE = '22023';
  END IF;
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.id = p_operation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.id = p_operation_id FOR UPDATE;
  IF v_operation.state IS DISTINCT FROM 'needs_review' THEN RETURN false; END IF;
  -- The scope the attempt was settled under must still hold at this transition.
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_operation.intent_id AND intent.integration_id = v_operation.integration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal complete review scope unavailable' USING ERRCODE = '42501';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.goal_complete_operations
     SET state = 'reviewed', review_note = pg_catalog.btrim(p_note), reviewed_at = v_now
   WHERE id = v_operation.id;
  INSERT INTO public.customer_savings_events
    (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
  SELECT v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
         'goal_complete_review_cleared', 'system',
         pg_catalog.jsonb_build_object('operation_id', v_operation.id)
   WHERE EXISTS (SELECT 1 FROM public.customer_savings_goals AS goal
                  WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
                    AND goal.merchant_id = v_intent.merchant_id);
  RETURN true;
END;
$$;

-- service_role has no USAGE on schema piggyvest_primary (and must not get it),
-- so ops tooling calls this thin public wrapper instead.
CREATE FUNCTION public.clear_goal_complete_review(p_operation_id uuid, p_note text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT piggyvest_primary.clear_goal_complete_review(p_operation_id, p_note);
$$;

-- Funding may not be reserved for a goal whose complete is in flight or done.
CREATE FUNCTION piggyvest_primary.block_funding_during_goal_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_complete_operations AS complete
     WHERE complete.goal_id = NEW.goal_id AND complete.state IN ('reserved', 'dispatched', 'confirmed')) THEN
    RAISE EXCEPTION 'savings goal is being completed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER block_funding_during_goal_complete
  BEFORE INSERT ON piggyvest_primary.savings_operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_funding_during_goal_complete();

-- An order redemption may not spend a goal whose complete is reserved,
-- dispatched or confirmed (goals bound to a PiggyVest wallet are already
-- refused by the S6 redemption trigger; this keeps the fence explicit).
CREATE FUNCTION piggyvest_primary.block_redemption_during_goal_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_complete_operations AS complete
     WHERE complete.goal_id = NEW.goal_id AND complete.state IN ('reserved', 'dispatched', 'confirmed')) THEN
    RAISE EXCEPTION 'savings_goal_complete_in_progress' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER block_redemption_during_goal_complete
  BEFORE INSERT ON public.customer_savings_redemptions
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_redemption_during_goal_complete();

-- The legacy contribution fence from S6 already refuses any non-PiggyVest
-- contribution to a goal bound to a PiggyVest wallet, which covers every
-- goal that can be completed.

-- A cancel may not be reserved or dispatched for a goal that has a complete
-- in flight or done. The S6 cancel functions are not edited; this trigger on
-- their table is the fence. Settlement transitions are not blocked: a cancel
-- the provider already executed must still be recorded.
CREATE FUNCTION piggyvest_primary.block_goal_cancel_during_goal_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.state IN ('reserved', 'dispatched')
    AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state)
    AND EXISTS (
      SELECT 1 FROM piggyvest_primary.goal_complete_operations AS complete
       WHERE complete.goal_id = NEW.goal_id
         AND complete.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')) THEN
    RAISE EXCEPTION 'savings goal is being completed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER block_goal_cancel_during_goal_complete
  BEFORE INSERT OR UPDATE OF state ON piggyvest_primary.goal_cancel_operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_goal_cancel_during_goal_complete();

-- Evidence role: resolves an outflow webhook reference to the complete attempt
-- (dispatched, or released after dispatch) so reconciliation needs no client.
CREATE FUNCTION piggyvest_primary.find_dispatched_goal_complete_by_reference(
  integration_id uuid,
  environment text,
  reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = find_dispatched_goal_complete_by_reference.integration_id
     AND binding.environment = find_dispatched_goal_complete_by_reference.environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object('operationId', op.id) INTO v_result
    FROM piggyvest_primary.goal_complete_operations AS op
   WHERE op.integration_id = find_dispatched_goal_complete_by_reference.integration_id
     AND op.reference = find_dispatched_goal_complete_by_reference.reference
     AND (op.state = 'dispatched' OR (op.state = 'released' AND op.dispatched_at IS NOT NULL))
   ORDER BY op.dispatched_at DESC
   LIMIT 1;
  RETURN v_result;
END;
$$;

-- Authorizer role: true only for a live (issued, unexpired) operation this
-- database issued for this integration, customer intent and goal. The PIN
-- verify route asks before minting a proof, so an invented, expired or
-- foreign operation id never holds a proof slot. The reserve step still makes
-- the binding decision; this is a pre-check only.
CREATE FUNCTION piggyvest_primary.check_goal_complete_issued(scope jsonb, goal_id uuid, operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
BEGIN
  IF goal_id IS NULL OR operation_id IS NULL THEN
    RETURN false;
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  RETURN EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_complete_operations AS op
     WHERE op.id = check_goal_complete_issued.operation_id
       AND op.goal_id = check_goal_complete_issued.goal_id
       AND op.intent_id = v_intent_id
       AND op.integration_id = (scope ->> 'integrationId')::uuid
       AND op.state = 'issued' AND op.expires_at > pg_catalog.clock_timestamp())
    AND piggyvest_primary.goal_complete_eligible(check_goal_complete_issued.goal_id) IS TRUE;
END;
$$;

-- Customer and goal deletion wait for an unresolved complete: settlement needs
-- the live customer row (ownership join) and goal row. Reserved attempts are
-- released when stale and dispatched ones settle or release, so no account is
-- locked for good.
CREATE FUNCTION piggyvest_primary.block_unsettled_goal_complete_customer_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_complete_operations AS complete
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = complete.intent_id
    WHERE intent.customer_id = OLD.id AND complete.state IN ('reserved', 'dispatched')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled goal completions' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER primary_goal_complete_block_unsettled_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_goal_complete_customer_deletion();

CREATE FUNCTION piggyvest_primary.block_unsettled_goal_complete_goal_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_complete_operations AS complete
    WHERE complete.goal_id = OLD.id AND complete.state IN ('reserved', 'dispatched')
  ) THEN
    RAISE EXCEPTION 'cannot delete goal with unsettled goal completions' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER primary_goal_complete_block_unsettled_goal_deletion
  BEFORE DELETE ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_goal_complete_goal_deletion();


-- Funding availability counts a settled goal-complete transfer as well as the S6
-- refund. This is the S6 (20261103085004) definition with one added statement;
-- its grants persist through CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION piggyvest_primary.reserve_savings_before_interest(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  resolved_intent_id uuid := piggyvest_primary.assert_savings_scope(scope);
  operation piggyvest_primary.savings_operations%ROWTYPE;
  goal public.customer_savings_goals%ROWTYPE;
  destination piggyvest_primary.savings_destinations%ROWTYPE;
  amount bigint;
  available_kobo numeric;
  capacity_kobo numeric;
  wallet_id uuid;
  wallet_balance numeric;
  transaction_id uuid:=pg_catalog.gen_random_uuid();
  source_wallet text;
  source_customer text;
BEGIN
  IF request IS NULL OR jsonb_typeof(request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(request))<>3
    OR NOT request ?& ARRAY['goalId','operationId','amountKobo'] OR jsonb_typeof(request->'amountKobo') IS DISTINCT FROM 'number'
    OR request->>'amountKobo' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid savings request' USING ERRCODE='22023'; END IF;
  amount:=(request->>'amountKobo')::bigint;
  IF amount>9999999999 THEN RAISE EXCEPTION 'savings amount outside ledger range' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('primary-savings:' || resolved_intent_id::text,0));
  SELECT * INTO operation FROM piggyvest_primary.savings_operations WHERE id=(request->>'operationId')::uuid FOR UPDATE;
  IF FOUND THEN
    IF operation.intent_id<>resolved_intent_id OR operation.goal_id<>(request->>'goalId')::uuid OR operation.amount_kobo<>amount THEN RETURN jsonb_build_object('status','conflict'); END IF;
    RETURN jsonb_build_object('status',CASE WHEN operation.state='confirmed' THEN 'confirmed' WHEN operation.state='cancelled' THEN 'conflict' ELSE 'pending' END);
  END IF;
  SELECT candidate.* INTO goal FROM public.customer_savings_goals candidate
    WHERE candidate.id=(request->>'goalId')::uuid AND candidate.customer_id=(scope->>'customerId')::uuid
      AND candidate.merchant_id=(scope->>'merchantId')::uuid AND candidate.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE='42501'; END IF;
  SELECT candidate.* INTO destination FROM piggyvest_primary.savings_destinations candidate
    WHERE candidate.integration_id=(scope->>'integrationId')::uuid AND candidate.goal_id=goal.id AND candidate.intent_id=resolved_intent_id AND candidate.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'savings destination unavailable' USING ERRCODE='42501'; END IF;
  SELECT provider_wallet_id,provider_customer_id INTO source_wallet,source_customer FROM piggyvest_primary.onboarding_intents WHERE id=resolved_intent_id;
  IF source_wallet=destination.provider_wallet_id THEN RAISE EXCEPTION 'identical savings wallets' USING ERRCODE='22023'; END IF;
  IF source_customer IS NULL THEN RAISE EXCEPTION 'savings customer unavailable' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(sum((financial_identity->>'amountKobo')::numeric),0) INTO available_kobo FROM piggyvest_primary.inflow_receipts WHERE inflow_receipts.intent_id=resolved_intent_id;
  SELECT available_kobo-COALESCE(sum(amount_kobo),0) INTO available_kobo FROM piggyvest_primary.savings_operations WHERE savings_operations.intent_id=resolved_intent_id AND state<>'cancelled';
  -- A settled goal-cancel refund (confirmed, or settled into review) is money
  -- back in the main wallet; only the refund's own amount counts.
  SELECT available_kobo+COALESCE(sum(refund.amount_kobo),0) INTO available_kobo FROM piggyvest_primary.goal_cancel_operations refund WHERE refund.intent_id=resolved_intent_id AND refund.state IN ('confirmed','needs_review','reviewed');
  -- A settled goal-complete transfer is money back in the main wallet too.
  SELECT available_kobo+COALESCE(sum(done.amount_kobo),0) INTO available_kobo FROM piggyvest_primary.goal_complete_operations done WHERE done.intent_id=resolved_intent_id AND done.state IN ('confirmed','needs_review','reviewed');
  SELECT (goal.target_amount-goal.current_amount)*100-COALESCE(sum(amount_kobo),0) INTO capacity_kobo FROM piggyvest_primary.savings_operations WHERE goal_id=goal.id AND state IN ('reserved','dispatched');
  IF available_kobo<amount OR capacity_kobo<amount THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  UPDATE public.customer_wallets SET available_balance=available_balance-amount::numeric/100,updated_at=pg_catalog.clock_timestamp()
    WHERE customer_id=(scope->>'customerId')::uuid AND merchant_id=(scope->>'merchantId')::uuid AND available_balance>=amount::numeric/100
    RETURNING id,available_balance INTO wallet_id,wallet_balance;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','insufficient'); END IF;
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,status,description)
    VALUES(transaction_id,wallet_id,(scope->>'customerId')::uuid,(scope->>'merchantId')::uuid,'redemption',amount::numeric/100,wallet_balance,'piggyvest_primary_savings',(request->>'operationId')::uuid,'pending','Savings transfer pending');
  INSERT INTO piggyvest_primary.savings_operations(id,integration_id,intent_id,goal_id,amount_kobo,source_wallet_id,destination_wallet_id,reference,state,wallet_transaction_id)
    VALUES((request->>'operationId')::uuid,(scope->>'integrationId')::uuid,resolved_intent_id,goal.id,amount,source_wallet,destination.provider_wallet_id,'pvb-save-' || (request->>'operationId'),'reserved',transaction_id)
    RETURNING * INTO operation;
  RETURN jsonb_build_object('status','claimed','reservation',jsonb_build_object('operationId',operation.id,'goalId',goal.id,'amountKobo',amount,'sourceWalletId',source_wallet,'destinationWalletId',destination.provider_wallet_id,'reference',operation.reference,'businessId',scope->>'businessId','providerCustomerId',source_customer));
END $$;


-- The daily reconciliation compares each goal wallet with what our records say
-- it holds: confirmed funding MINUS settled cancel refunds and settled
-- completions, never below 0.
-- Without the subtraction a legitimately cancelled goal (an empty provider
-- wallet) would look short forever and page the operator every day. A refund
-- above the funding is interest the books never recorded, so the expected
-- balance floors at 0 instead of going negative (a negative value would make
-- the whole snapshot invalid). A fully cancelled goal expects 0. This is the 20261103072500 definition with only the wallet
-- query changed; its grants persist through CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_daily_reconciliation(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  stale_seconds integer;
  business text;
  as_of timestamptz;
  stuck jsonb;
  stuck_total integer;
  wallets jsonb;
  wallets_total integer;
BEGIN
  IF options IS NULL OR jsonb_typeof(options)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(options))<>1
    OR COALESCE(jsonb_typeof(options->'staleAfterSeconds')='number',false) IS NOT TRUE
    OR COALESCE((options->>'staleAfterSeconds') ~ '^[0-9]{2,6}$',false) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid reconciliation options' USING ERRCODE='22023';
  END IF;
  stale_seconds:=(options->>'staleAfterSeconds')::integer;
  IF stale_seconds NOT BETWEEN 60 AND 604800 THEN
    RAISE EXCEPTION 'invalid reconciliation options' USING ERRCODE='22023';
  END IF;
  SELECT binding.business_id INTO business FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_daily_reconciliation.integration_id AND binding.environment=read_daily_reconciliation.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  -- The clock is read only after the lock above is held.
  as_of:=pg_catalog.clock_timestamp();
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'operationId',item.id,'goalId',item.goal_id,'state',item.state,'amountKobo',item.amount_kobo,
      'sourceWalletId',item.source_wallet_id,'destinationWalletId',item.destination_wallet_id,
      'reference',item.reference,'ageSeconds',item.age) ORDER BY item.age DESC,item.id),'[]'::jsonb)
    INTO stuck_total,stuck FROM (
    SELECT operation.id,operation.goal_id,operation.state,operation.amount_kobo,operation.source_wallet_id,
      operation.destination_wallet_id,operation.reference,
      pg_catalog.floor(pg_catalog.date_part('epoch',as_of-operation.created_at))::bigint AS age,
      count(*) OVER () AS total
    FROM piggyvest_primary.savings_operations operation
    WHERE operation.integration_id=read_daily_reconciliation.integration_id
      AND operation.state IN ('reserved','dispatched')
      AND operation.created_at<=as_of-pg_catalog.make_interval(secs=>stale_seconds)
    ORDER BY age DESC,operation.id LIMIT 200) item;
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'walletId',item.wallet_id,'expectedKobo',item.expected_kobo) ORDER BY item.wallet_id),'[]'::jsonb)
    INTO wallets_total,wallets FROM (
    SELECT movement.wallet_id,GREATEST(0,sum(movement.delta_kobo))::bigint AS expected_kobo,count(*) OVER () AS total
    FROM (
      SELECT operation.destination_wallet_id AS wallet_id,operation.amount_kobo AS delta_kobo
        FROM piggyvest_primary.savings_operations operation
       WHERE operation.integration_id=read_daily_reconciliation.integration_id AND operation.state='confirmed'
      UNION ALL
      SELECT cancel.source_wallet_id,-cancel.amount_kobo
        FROM piggyvest_primary.goal_cancel_operations cancel
       WHERE cancel.integration_id=read_daily_reconciliation.integration_id
         AND cancel.state IN ('confirmed','needs_review','reviewed')
      UNION ALL
      SELECT done.source_wallet_id,-done.amount_kobo
        FROM piggyvest_primary.goal_complete_operations done
       WHERE done.integration_id=read_daily_reconciliation.integration_id
         AND done.state IN ('confirmed','needs_review','reviewed')
    ) movement
    GROUP BY movement.wallet_id ORDER BY movement.wallet_id LIMIT 500) item;
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'staleAfterSeconds',stale_seconds,'businessId',business,
    'stuck',stuck,'stuckTotal',stuck_total,'wallets',wallets,'walletsTotal',wallets_total);
END $$;


-- Evidence role: the purchase request of a settled completion whose owner
-- alert has not been marked sent. Null when there is nothing to alert. The
-- request row exists before this can return it (settlement wrote it).
CREATE FUNCTION piggyvest_primary.read_goal_purchase_request_alert(
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
  v_result jsonb;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = read_goal_purchase_request_alert.integration_id
     AND binding.environment = read_goal_purchase_request_alert.environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase request authority unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object('requestId', request.id, 'operationId', request.complete_operation_id)
    INTO v_result
    FROM piggyvest_primary.goal_purchase_requests AS request
   WHERE request.complete_operation_id = read_goal_purchase_request_alert.operation_id
     AND request.integration_id = read_goal_purchase_request_alert.integration_id
     AND request.state = 'open' AND request.alerted_at IS NULL;
  RETURN v_result;
END;
$$;

-- Evidence role: records that the owner alert was delivered. Only ever moves
-- alerted_at from null once; false when there was nothing to mark.
CREATE FUNCTION piggyvest_primary.mark_goal_purchase_request_alerted(
  integration_id uuid,
  environment text,
  operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
   WHERE binding.id = mark_goal_purchase_request_alerted.integration_id
     AND binding.environment = mark_goal_purchase_request_alerted.environment
     AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase request authority unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE piggyvest_primary.goal_purchase_requests AS request
     SET alerted_at = pg_catalog.clock_timestamp()
   WHERE request.complete_operation_id = mark_goal_purchase_request_alerted.operation_id
     AND request.integration_id = mark_goal_purchase_request_alerted.integration_id
     AND request.alerted_at IS NULL;
  RETURN FOUND;
END;
$$;

-- Ops tooling (service role): the open purchase requests, oldest first, with
-- whether the owner alert was sent. This is how a request whose alert failed
-- is still found. service_role has no USAGE on piggyvest_primary.
CREATE FUNCTION public.list_open_goal_purchase_requests(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid purchase request limit' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'requestId', item.id, 'operationId', item.complete_operation_id,
        'merchantId', item.merchant_id, 'customerId', item.customer_id,
        'goalId', item.goal_id, 'goalTitle', item.goal_title,
        'targetAmount', item.target_amount, 'productId', item.product_id,
        'variantId', item.variant_id, 'amountKobo', item.amount_kobo,
        'createdAt', item.created_at, 'alertedAt', item.alerted_at)
        ORDER BY item.created_at, item.id)
      FROM (SELECT request.* FROM piggyvest_primary.goal_purchase_requests AS request
             WHERE request.state = 'open'
             ORDER BY request.created_at, request.id LIMIT p_limit) AS item),
    '[]'::jsonb);
END;
$$;

-- Ops tooling (service role): the owner finished the purchase by hand.
CREATE FUNCTION public.fulfil_goal_purchase_request(p_request_id uuid, p_note text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL OR p_note IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid purchase request fulfilment' USING ERRCODE = '22023';
  END IF;
  UPDATE piggyvest_primary.goal_purchase_requests AS request
     SET state = 'fulfilled', fulfilled_at = pg_catalog.clock_timestamp(),
         fulfilment_note = pg_catalog.btrim(p_note)
   WHERE request.id = p_request_id AND request.state = 'open';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.goal_complete_eligible(uuid),
  piggyvest_primary.goal_cancel_in_flight(uuid),
  piggyvest_primary.issue_goal_complete(jsonb, uuid),
  piggyvest_primary.reserve_goal_complete_with_pin(jsonb, jsonb, text),
  piggyvest_primary.manage_goal_complete(jsonb, uuid, text, bigint),
  piggyvest_primary.read_goal_complete_status(jsonb, uuid),
  piggyvest_primary.read_dispatched_goal_complete(uuid, text, uuid),
  piggyvest_primary.goal_complete_proof_valid(jsonb),
  piggyvest_primary.settle_goal_complete(uuid, text, jsonb),
  piggyvest_primary.release_failed_goal_complete(uuid, text, jsonb),
  piggyvest_primary.clear_goal_complete_review(uuid, text),
  piggyvest_primary.block_funding_during_goal_complete(),
  piggyvest_primary.block_redemption_during_goal_complete(),
  piggyvest_primary.block_goal_cancel_during_goal_complete(),
  piggyvest_primary.find_dispatched_goal_complete_by_reference(uuid, text, text),
  piggyvest_primary.check_goal_complete_issued(jsonb, uuid, uuid),
  piggyvest_primary.block_unsettled_goal_complete_customer_deletion(),
  piggyvest_primary.block_unsettled_goal_complete_goal_deletion(),
  piggyvest_primary.read_goal_purchase_request_alert(uuid, text, uuid),
  piggyvest_primary.mark_goal_purchase_request_alerted(uuid, text, uuid),
  public.clear_goal_complete_review(uuid, text),
  public.list_open_goal_purchase_requests(integer),
  public.fulfil_goal_purchase_request(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- Ops tooling (service role) is the only caller of the review clearance and of
-- the purchase request list and fulfilment (public wrappers; the
-- piggyvest_primary functions have no grant for any role).
GRANT EXECUTE ON FUNCTION public.clear_goal_complete_review(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_open_goal_purchase_requests(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfil_goal_purchase_request(uuid, text) TO service_role;

-- consume_goal_pin_proof stays revoked from the authorizer login: the complete
-- PIN is spent only inside reserve_goal_complete_with_pin, bound to a
-- server-issued operation id.
GRANT EXECUTE ON FUNCTION piggyvest_primary.issue_goal_complete(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_goal_complete_with_pin(jsonb, jsonb, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_complete(jsonb, uuid, text, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_complete_status(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.check_goal_complete_issued(jsonb, uuid, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.find_dispatched_goal_complete_by_reference(uuid, text, text)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_dispatched_goal_complete(uuid, text, uuid)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_complete(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_goal_complete(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_purchase_request_alert(uuid, text, uuid)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.mark_goal_purchase_request_alerted(uuid, text, uuid)
  TO piggyvest_primary_evidence;

-- The funded-goal trigger derives "completed" from funding (current amount plus
-- paid interest against the target) and walks the status back when funding falls
-- short. Settling a goal complete moves the whole balance out, so funding is
-- zero by design and the trigger would reopen the goal it just completed (and
-- would again on any later no-op update of the row). A goal with a settled
-- (confirmed) goal complete keeps the status settlement wrote. Everything else
-- is unchanged from the original function.
CREATE OR REPLACE FUNCTION piggyvest_primary.complete_funded_goal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE totals record; funded numeric;
BEGIN
  IF NEW.goal_kind<>'legacy' OR NEW.status NOT IN ('active','paused','completed') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations AS done
              WHERE done.goal_id=NEW.id AND done.state='confirmed') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO totals FROM piggyvest_primary.completion_totals(NEW.id,NEW.merchant_id,NEW.customer_id);
  IF NOT FOUND THEN RETURN NEW; END IF;
  funded:=NEW.current_amount*100+totals.paid_interest_kobo;
  IF totals.paid_interest_kobo<0 OR NEW.target_amount<=0 THEN RETURN NEW; END IF;
  IF funded>=NEW.target_amount*100 THEN
    NEW.status:='completed';
    NEW.completed_at:=coalesce(OLD.completed_at,clock_timestamp());
  ELSIF OLD.status='completed' OR NEW.status='completed' THEN
    NEW.status:=CASE WHEN OLD.status IN ('active','paused') THEN OLD.status ELSE 'paused' END;
    NEW.completed_at:=NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.complete_funded_goal()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
