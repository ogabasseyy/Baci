-- PiggyVest goal cancel: an EARLY cancel refunds only the customer's saved
-- principal; the interest PiggyVest paid into the goal wallet is forfeited to
-- Ogabassey's interest wallet (owner decision 2026-11-12). Completing a goal
-- (target reached) is unchanged and keeps its interest.
--
-- Before this migration the cancel moved the WHOLE provider goal-wallet
-- balance, interest included, to the customer's main wallet
-- (20261103085004, settlement from 20261104130600). Dark: behind the existing
-- PiggyVest flags, and the interest leg also needs an operator to configure
-- goal_interest_forfeit_wallets (until then a cancel that owes interest is
-- refused before anything moves, and one without interest works as before).
--
-- Sections:
--   1. goal_interest_forfeit_wallets (the configured Ogabassey wallet)
--   2. goal_cancel_operations.forfeited_interest_kobo + the forfeit ledger
--      table goal_cancel_interest_forfeits
--   3. dispatch_goal_cancel_split (replaces the whole-balance dispatch) and
--      manage_goal_cancel without its 'dispatch' action
--   4. read_goal_cancel_amounts (what the app shows)
--   5. settle_goal_cancel: tolerates the not-yet-forfeited interest
--   6. forfeit leg, authorizer side: claim / release
--   7. forfeit leg, evidence side: read, find, settle, release
--   8. trigger: a released cancel releases its unsent forfeit; deletion fence
--   9. grants
--
-- The money rules:
--  * Principal = the goal's recorded confirmed principal
--    (customer_savings_goals.current_amount, which never includes interest;
--    the app adds paid interest on top of it for display). Interest = the
--    provider goal-wallet balance at dispatch minus the principal. The
--    database computes both from the balance the caller read at PiggyVest; the
--    caller never sizes either leg.
--  * A provider balance BELOW the principal is never refunded: the attempt is
--    released before anything is sent and the answer is needs_review.
--  * Two transfers, two never-reused references: the customer leg keeps
--    'pvb-cancel-<goalId>[-n]'; the forfeit leg is 'pvb-forfeit-<goalId>' then
--    '-<n>', one more than the highest ever issued for the goal (UNIQUE).
--  * The forfeit is sent only after the customer's principal is CONFIRMED by
--    a verified provider record, so interest can never leave for a cancel that
--    did not happen. A released customer leg releases its unsent forfeit.
--  * Each leg is claimed exactly once before its single POST (reserved ->
--    dispatched under the intent lock); after that only a status read decides
--    (202 = processing, timeout = indeterminate, never a blind resend). A
--    definitive rejection with no transfer on record releases the forfeit and
--    plans a replacement under a fresh reference; the third rejection goes to
--    needs_review instead.
--  * The forfeit table is the ledger of forfeited interest, and settlement
--    writes a distinct 'goal_cancel_interest_forfeited' savings event.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('piggyvest_primary.goal_cancel_operations') IS NULL
    OR to_regprocedure('piggyvest_primary.settle_goal_cancel(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('piggyvest_primary.goal_cancel_proof_valid(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'goal cancel refund schema missing; apply 20261103085004 first';
  END IF;
END $guard$;

-- 1. Ogabassey's PiggyVest wallet that receives forfeited goal interest, one
-- per integration. Set by an operator (owner SQL, runbook); no role can read
-- or write it except through the functions below.
CREATE TABLE piggyvest_primary.goal_interest_forfeit_wallets (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  provider_wallet_id text NOT NULL UNIQUE
    CHECK (pg_catalog.octet_length(provider_wallet_id) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE piggyvest_primary.goal_interest_forfeit_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_interest_forfeit_wallets_deny ON piggyvest_primary.goal_interest_forfeit_wallets
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.goal_interest_forfeit_wallets
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- 2. What each attempt forfeited (NULL for attempts dispatched before this
-- migration, which moved the whole balance), and the forfeit leg ledger.
ALTER TABLE piggyvest_primary.goal_cancel_operations
  ADD COLUMN forfeited_interest_kobo bigint
    CHECK (forfeited_interest_kobo IS NULL OR forfeited_interest_kobo BETWEEN 0 AND 9999999999);

CREATE TABLE piggyvest_primary.goal_cancel_interest_forfeits (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  cancel_operation_id uuid NOT NULL REFERENCES piggyvest_primary.goal_cancel_operations(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  intent_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'dispatched', 'confirmed', 'released', 'needs_review')),
  reference text NOT NULL CHECK (
    reference = 'pvb-forfeit-' || goal_id::text
    OR reference ~ ('^pvb-forfeit-' || goal_id::text || '-[1-9][0-9]{0,5}$')),
  source_wallet_id text NOT NULL,
  destination_wallet_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  provider_transaction_id text,
  reserved_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  settled_at timestamptz,
  -- Set the first time a claim reports this forfeit stuck (needs_review or
  -- unavailable), so a person is paged once, not on every status poll.
  alerted_at timestamptz,
  CONSTRAINT goal_cancel_forfeit_reference_key UNIQUE (reference),
  CHECK (source_wallet_id <> destination_wallet_id),
  CHECK (state = 'reserved' OR state = 'released' OR state = 'needs_review' OR dispatched_at IS NOT NULL),
  CHECK (state <> 'confirmed' OR provider_transaction_id IS NOT NULL)
);
CREATE UNIQUE INDEX goal_cancel_forfeit_one_live_idx
  ON piggyvest_primary.goal_cancel_interest_forfeits (cancel_operation_id)
  WHERE state IN ('reserved', 'dispatched', 'confirmed', 'needs_review');
CREATE UNIQUE INDEX goal_cancel_forfeit_provider_transaction_idx
  ON piggyvest_primary.goal_cancel_interest_forfeits (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX goal_cancel_forfeit_integration_idx ON piggyvest_primary.goal_cancel_interest_forfeits (integration_id);
CREATE INDEX goal_cancel_forfeit_goal_idx ON piggyvest_primary.goal_cancel_interest_forfeits (goal_id);
CREATE INDEX goal_cancel_forfeit_intent_idx ON piggyvest_primary.goal_cancel_interest_forfeits (intent_id);

ALTER TABLE piggyvest_primary.goal_cancel_interest_forfeits ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_cancel_interest_forfeits_deny ON piggyvest_primary.goal_cancel_interest_forfeits
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.goal_cancel_interest_forfeits
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

-- The next never-used forfeit reference for a goal (the bare one counts as 0).
CREATE FUNCTION piggyvest_primary.next_goal_cancel_forfeit_reference(p_goal_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'pvb-forfeit-' || p_goal_id::text || CASE
    WHEN highest.value < 0 THEN '' ELSE '-' || (highest.value + 1)::text END
    FROM (SELECT COALESCE(pg_catalog.max(CASE
                   WHEN issued.reference = 'pvb-forfeit-' || p_goal_id::text THEN 0
                   ELSE pg_catalog.substr(issued.reference,
                          pg_catalog.char_length('pvb-forfeit-' || p_goal_id::text) + 2)::integer
                 END), -1) AS value
            FROM piggyvest_primary.goal_cancel_interest_forfeits AS issued
           WHERE issued.goal_id = p_goal_id) AS highest;
$$;

-- 3. The only dispatch a cancel has now: reserved -> dispatched with the
-- principal as the customer leg, plus a reserved forfeit leg for the interest.
-- provider_balance_kobo is the goal-wallet balance the caller just read at
-- PiggyVest. Answers (jsonb status):
--   dispatched          {principalKobo, forfeitedInterestKobo}
--   not_claimed         the attempt is not reserved for this scope, or a
--                       re-check failed (same as the old dispatch's false)
--   needs_review        provider balance below the principal, or a principal
--                       that is not a whole positive kobo amount; released
--   forfeit_unavailable interest is owed but no enabled interest wallet;
--                       released
CREATE FUNCTION piggyvest_primary.dispatch_goal_cancel_split(
  scope jsonb,
  operation_id uuid,
  provider_balance_kobo bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_current numeric;
  v_principal bigint;
  v_interest bigint;
  v_wallet text;
  v_now timestamptz;
BEGIN
  IF operation_id IS NULL OR provider_balance_kobo IS NULL
    OR provider_balance_kobo NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'invalid goal cancel dispatch' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = dispatch_goal_cancel_split.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF NOT FOUND OR v_operation.state <> 'reserved' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_claimed');
  END IF;
  -- The same re-checks the whole-balance dispatch made at this transition.
  SELECT goal.current_amount INTO v_current
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
     FOR UPDATE OF goal;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_claimed');
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_operation.goal_id AND funding.state IN ('reserved', 'dispatched'))
    OR piggyvest_primary.goal_cancel_needs_review(v_operation.goal_id) IS NOT FALSE THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_claimed');
  END IF;
  -- Nothing has been sent for a reserved attempt, so refusing here releases it.
  IF v_current IS NULL OR v_current * 100 <> pg_catalog.trunc(v_current * 100)
    OR v_current * 100 < 1 OR v_current * 100 > provider_balance_kobo THEN
    UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  END IF;
  v_principal := (v_current * 100)::bigint;
  v_interest := provider_balance_kobo - v_principal;
  IF v_interest > 0 THEN
    SELECT forfeit.provider_wallet_id INTO v_wallet
      FROM piggyvest_primary.goal_interest_forfeit_wallets AS forfeit
     WHERE forfeit.integration_id = v_operation.integration_id AND forfeit.enabled
       AND forfeit.provider_wallet_id <> v_operation.source_wallet_id
       AND forfeit.provider_wallet_id <> v_operation.destination_wallet_id
       FOR SHARE;
    IF NOT FOUND THEN
      UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
      RETURN pg_catalog.jsonb_build_object('status', 'forfeit_unavailable');
    END IF;
  END IF;
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = 'dispatched', amount_kobo = v_principal, forfeited_interest_kobo = v_interest,
         dispatched_at = v_now
   WHERE id = v_operation.id;
  IF v_interest > 0 THEN
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
      'reserved', piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
      v_operation.source_wallet_id, v_wallet, v_interest, v_now);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'dispatched', 'principalKobo', v_principal, 'forfeitedInterestKobo', v_interest);
END;
$$;

-- manage_goal_cancel keeps cancel / cancel_stale / release; its 'dispatch'
-- (which moved whatever amount the caller passed, interest included) now
-- refuses, so the split above is the only way an attempt is dispatched. Same
-- signature, so its grants persist through CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION piggyvest_primary.manage_goal_cancel(
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
  IF action = 'dispatch' THEN
    -- Retired: dispatch_goal_cancel_split sizes both legs itself.
    RETURN false;
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
  UPDATE piggyvest_primary.goal_cancel_operations SET state = 'released' WHERE id = v_operation.id;
  RETURN true;
END;
$$;

-- 4. What a dispatched (or later) attempt returns to the customer and what it
-- forfeits, for the app to show from the server. NULL before dispatch and for
-- attempts dispatched before the split existed.
CREATE FUNCTION piggyvest_primary.read_goal_cancel_amounts(scope jsonb, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_result jsonb;
BEGIN
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT pg_catalog.jsonb_build_object(
      'principalKobo', op.amount_kobo, 'forfeitedInterestKobo', op.forfeited_interest_kobo)
    INTO v_result
    FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = read_goal_cancel_amounts.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid
     AND op.amount_kobo IS NOT NULL AND op.forfeited_interest_kobo IS NOT NULL;
  RETURN v_result;
END;
$$;

-- 5. Customer-leg settlement (the 20261104130600 definition). Changed: the
-- residual the provider still holds after the principal moved may be up to
-- the interest this attempt has planned but not yet forfeited (that money is
-- meant to stay until the forfeit leg runs); anything above it is still a
-- review. The event records both amounts. Same signature, grants persist.
CREATE OR REPLACE FUNCTION piggyvest_primary.settle_goal_cancel(
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
  v_late boolean := false;
  v_review boolean := false;
  v_goal_amount numeric;
  v_residual bigint := 0;
  v_expected_residual bigint := 0;
  v_target text;
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
  IF v_operation.state IN ('confirmed', 'needs_review', 'reviewed') THEN
    IF v_operation.provider_transaction_id = proof ->> 'providerTransactionId' THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;
  IF v_operation.state = 'released' AND v_operation.dispatched_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS live
                WHERE live.goal_id = v_operation.goal_id AND live.id <> v_operation.id
                  AND live.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')) THEN
      RETURN 'conflict';
    END IF;
    v_late := true;
  ELSIF v_operation.state <> 'dispatched' THEN
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS other
              WHERE other.integration_id = v_binding.id
                AND other.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                WHERE funding.integration_id = v_binding.id
                  AND funding.provider_transaction_id = proof ->> 'providerTransactionId')
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
                WHERE forfeit.integration_id = v_binding.id
                  AND forfeit.provider_transaction_id = proof ->> 'providerTransactionId') THEN
    RETURN 'conflict';
  END IF;
  v_residual := COALESCE((proof ->> 'residualKobo')::bigint, 0);
  -- Interest planned for the forfeit leg and not yet sent or settled is meant
  -- to still be in the goal wallet.
  SELECT COALESCE(pg_catalog.sum(forfeit.amount_kobo), 0) INTO v_expected_residual
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = v_operation.id AND forfeit.state IN ('reserved', 'dispatched');
  SELECT goal.current_amount INTO v_goal_amount FROM public.customer_savings_goals AS goal
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id FOR UPDATE;
  IF v_late THEN
    v_review := EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
                         WHERE funding.goal_id = v_operation.goal_id
                           AND funding.state IN ('reserved', 'dispatched', 'confirmed')
                           AND funding.created_at >= v_operation.dispatched_at)
      OR COALESCE(v_goal_amount - v_operation.amount_kobo::numeric / 100, 0) > 0;
  END IF;
  v_review := v_review OR v_residual > v_expected_residual;
  v_target := CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END;
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = v_target, provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_operation.id;
  -- The principal returns to the PiggyVest main wallet at PiggyVest; the
  -- legacy in-house balance is NOT credited (see 20261104130600).
  v_now := pg_catalog.clock_timestamp();
  UPDATE public.customer_savings_goals AS goal
     SET status = CASE WHEN v_review THEN goal.status ELSE 'cancelled' END,
         cancelled_at = CASE WHEN v_review THEN goal.cancelled_at ELSE v_now END,
         future_debits_cancelled_at = CASE WHEN v_review THEN goal.future_debits_cancelled_at
           ELSE COALESCE(goal.future_debits_cancelled_at, v_now) END,
         current_amount = CASE
           WHEN v_review THEN GREATEST(0, goal.current_amount - v_operation.amount_kobo::numeric / 100)
           ELSE 0 END,
         updated_at = v_now
   WHERE goal.id = v_operation.goal_id AND goal.customer_id = v_intent.customer_id
     AND goal.merchant_id = v_intent.merchant_id AND goal.status <> 'spent';
  IF FOUND THEN
    INSERT INTO public.customer_savings_events
      (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
    VALUES (v_operation.goal_id, v_intent.merchant_id, v_intent.customer_id,
      CASE WHEN v_review THEN 'goal_cancel_needs_review' ELSE 'goal_cancelled_refunded' END, 'system',
      pg_catalog.jsonb_build_object('operation_id', v_operation.id, 'amount_kobo', v_operation.amount_kobo,
        'principal_kobo', v_operation.amount_kobo,
        'forfeited_interest_kobo', v_operation.forfeited_interest_kobo));
  END IF;
  IF v_review THEN RETURN 'conflict'; END IF;
  RETURN 'confirmed';
END;
$$;

-- Releases a dispatched forfeit row (definitive rejection, nothing moved) and
-- plans its replacement under a fresh reference; the third released forfeit
-- of an attempt goes to needs_review instead. Caller holds the intent lock
-- and the row lock. Returns the new state of the row.
CREATE FUNCTION piggyvest_primary.release_goal_cancel_forfeit_row(p_forfeit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_released integer;
  v_wallet text;
BEGIN
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = p_forfeit_id FOR UPDATE;
  SELECT pg_catalog.count(*) INTO v_released FROM piggyvest_primary.goal_cancel_interest_forfeits AS prior
   WHERE prior.cancel_operation_id = v_forfeit.cancel_operation_id AND prior.state = 'released';
  IF v_released >= 2 THEN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'needs_review' WHERE id = v_forfeit.id;
    RETURN 'needs_review';
  END IF;
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'released' WHERE id = v_forfeit.id;
  SELECT wallet.provider_wallet_id INTO v_wallet FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
   WHERE wallet.integration_id = v_forfeit.integration_id AND wallet.enabled;
  INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
    cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
    source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
  VALUES (v_forfeit.cancel_operation_id, v_forfeit.integration_id, v_forfeit.intent_id, v_forfeit.goal_id,
    'reserved', piggyvest_primary.next_goal_cancel_forfeit_reference(v_forfeit.goal_id),
    v_forfeit.source_wallet_id, COALESCE(v_wallet, v_forfeit.destination_wallet_id),
    v_forfeit.amount_kobo, pg_catalog.clock_timestamp());
  RETURN 'released';
END;
$$;

-- A stuck forfeit's claim answer; "alert" only the first time (stamps
-- alerted_at). Caller holds the row lock.
CREATE FUNCTION piggyvest_primary.report_stuck_goal_cancel_forfeit(p_forfeit_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET alerted_at = pg_catalog.clock_timestamp()
   WHERE id = p_forfeit_id AND alerted_at IS NULL;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', p_status, 'alert', true);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', p_status);
END;
$$;

-- 6. Forfeit leg, authorizer side. Claims the attempt's planned forfeit for
-- its single POST, only once the customer's principal is CONFIRMED. Answers:
--   claimed  {forfeit: transfer details}   send it now, exactly once
--   pending  {forfeitId}                   already sent; read its status
--   waiting                                principal not confirmed yet
--   confirmed / needs_review / none        nothing to send
--   unavailable                            interest wallet no longer enabled
-- needs_review and unavailable carry "alert": true the first time they are
-- reported for a forfeit (alerted_at is stamped), so the caller pages once.
CREATE FUNCTION piggyvest_primary.claim_goal_cancel_forfeit(scope jsonb, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  IF operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid goal cancel forfeit claim' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = claim_goal_cancel_forfeit.operation_id AND op.intent_id = v_intent_id
     AND op.integration_id = (scope ->> 'integrationId')::uuid;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'none'); END IF;
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = v_operation.id
     AND forfeit.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')
     FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'none'); END IF;
  IF v_forfeit.state = 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'confirmed');
  END IF;
  IF v_forfeit.state = 'needs_review' THEN
    RETURN piggyvest_primary.report_stuck_goal_cancel_forfeit(v_forfeit.id, 'needs_review');
  END IF;
  IF v_forfeit.state = 'dispatched' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending', 'forfeitId', v_forfeit.id);
  END IF;
  IF v_operation.state <> 'confirmed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'waiting');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
                  WHERE wallet.integration_id = v_forfeit.integration_id AND wallet.enabled
                    AND wallet.provider_wallet_id = v_forfeit.destination_wallet_id) THEN
    RETURN piggyvest_primary.report_stuck_goal_cancel_forfeit(v_forfeit.id, 'unavailable');
  END IF;
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_intent_id;
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET state = 'dispatched', dispatched_at = pg_catalog.clock_timestamp()
   WHERE id = v_forfeit.id;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'forfeit', pg_catalog.jsonb_build_object(
      'operationId', v_forfeit.id, 'goalId', v_forfeit.goal_id, 'amountKobo', v_forfeit.amount_kobo,
      'sourceWalletId', v_forfeit.source_wallet_id,
      'destinationWalletId', v_forfeit.destination_wallet_id,
      'reference', v_forfeit.reference, 'businessId', scope ->> 'businessId',
      'providerCustomerId', v_intent.provider_customer_id));
END;
$$;

-- 'release': dispatched -> released (or needs_review on the third), after a
-- definitive provider rejection with no transfer on record for the reference.
CREATE FUNCTION piggyvest_primary.manage_goal_cancel_forfeit(scope jsonb, forfeit_id uuid, action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  IF forfeit_id IS NULL OR action IS DISTINCT FROM 'release' THEN
    RAISE EXCEPTION 'invalid goal cancel forfeit transition' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = manage_goal_cancel_forfeit.forfeit_id AND forfeit.intent_id = v_intent_id
     AND forfeit.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF NOT FOUND OR v_forfeit.state <> 'dispatched' THEN RETURN false; END IF;
  PERFORM piggyvest_primary.release_goal_cancel_forfeit_row(v_forfeit.id);
  RETURN true;
END;
$$;

-- 7. Forfeit leg, evidence side. Same proof shape and checks as the customer
-- leg (goal_cancel_proof_valid); the "operationId" of a forfeit proof is the
-- forfeit id.
CREATE FUNCTION piggyvest_primary.assert_goal_cancel_evidence(integration_id uuid, environment text)
RETURNS piggyvest_primary.integrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = assert_goal_cancel_evidence.integration_id
     AND candidate.environment = assert_goal_cancel_evidence.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement authority unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_binding;
END;
$$;

CREATE FUNCTION piggyvest_primary.read_dispatched_goal_cancel_forfeit(
  integration_id uuid,
  environment text,
  forfeit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  SELECT pg_catalog.jsonb_build_object(
      'operationId', forfeit.id, 'goalId', forfeit.goal_id, 'amountKobo', forfeit.amount_kobo,
      'sourceWalletId', forfeit.source_wallet_id, 'destinationWalletId', forfeit.destination_wallet_id,
      'reference', forfeit.reference, 'businessId', v_binding.business_id,
      'providerCustomerId', intent.provider_customer_id)
    INTO v_result
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
    JOIN piggyvest_primary.onboarding_intents AS intent
      ON intent.id = forfeit.intent_id AND intent.integration_id = forfeit.integration_id
   WHERE forfeit.id = read_dispatched_goal_cancel_forfeit.forfeit_id
     AND forfeit.integration_id = v_binding.id AND forfeit.state = 'dispatched';
  RETURN v_result;
END;
$$;

CREATE FUNCTION piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(
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
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  SELECT pg_catalog.jsonb_build_object('operationId', forfeit.id) INTO v_result
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.integration_id = v_binding.id
     AND forfeit.reference = find_dispatched_goal_cancel_forfeit_by_reference.reference
     AND forfeit.state = 'dispatched';
  RETURN v_result;
END;
$$;

-- Loads and checks the forfeit a proof is about, under the intent lock.
-- NULL when the proof does not match the stored forfeit exactly.
CREATE FUNCTION piggyvest_primary.lock_goal_cancel_forfeit_for_proof(
  p_binding piggyvest_primary.integrations,
  proof jsonb
)
RETURNS piggyvest_primary.goal_cancel_interest_forfeits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  IF piggyvest_primary.goal_cancel_proof_valid(proof) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid settlement proof' USING ERRCODE = '22023';
  END IF;
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = (proof ->> 'operationId')::uuid AND forfeit.integration_id = p_binding.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_forfeit.intent_id::text, 0));
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = v_forfeit.id FOR UPDATE;
  IF v_forfeit.amount_kobo IS DISTINCT FROM (proof ->> 'amountKobo')::bigint
    OR v_forfeit.reference IS DISTINCT FROM proof ->> 'reference'
    OR v_forfeit.source_wallet_id IS DISTINCT FROM proof ->> 'sourceWalletId'
    OR v_forfeit.destination_wallet_id IS DISTINCT FROM proof ->> 'destinationWalletId'
    OR p_binding.business_id IS DISTINCT FROM proof ->> 'businessId' THEN
    RETURN NULL;
  END IF;
  RETURN v_forfeit;
END;
$$;

-- A verified successful forfeit transfer: confirmed, and recorded as forfeited
-- interest. Money left in the goal wallet after it is a review (the customer's
-- principal is already confirmed, so nothing else should be there).
CREATE FUNCTION piggyvest_primary.settle_goal_cancel_forfeit(
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
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
  v_review boolean;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  v_forfeit := piggyvest_primary.lock_goal_cancel_forfeit_for_proof(v_binding, proof);
  IF v_forfeit.id IS NULL THEN RETURN 'conflict'; END IF;
  IF v_forfeit.state IN ('confirmed', 'needs_review') THEN
    IF v_forfeit.provider_transaction_id = proof ->> 'providerTransactionId' THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  IF v_forfeit.state <> 'dispatched' THEN
    -- A success for a released forfeit (indexed late, possibly after its
    -- replacement was planned) is never settled automatically.
    RETURN 'conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits AS other
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
  v_review := COALESCE((proof ->> 'residualKobo')::bigint, 0) > 0;
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET state = CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END,
         provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp()
   WHERE id = v_forfeit.id;
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_forfeit.intent_id;
  INSERT INTO public.customer_savings_events
    (goal_id, merchant_id, customer_id, event_type, actor_type, metadata)
  SELECT v_forfeit.goal_id, v_intent.merchant_id, v_intent.customer_id,
         'goal_cancel_interest_forfeited', 'system',
         pg_catalog.jsonb_build_object('operation_id', v_forfeit.cancel_operation_id,
           'forfeit_id', v_forfeit.id, 'amount_kobo', v_forfeit.amount_kobo,
           'reference', v_forfeit.reference, 'needs_review', v_review)
   WHERE EXISTS (SELECT 1 FROM public.customer_savings_goals AS goal
                  WHERE goal.id = v_forfeit.goal_id AND goal.customer_id = v_intent.customer_id
                    AND goal.merchant_id = v_intent.merchant_id);
  IF v_review THEN RETURN 'conflict'; END IF;
  RETURN 'confirmed';
END;
$$;

-- A provider record showing the forfeit transfer FAILED: released and replaced.
CREATE FUNCTION piggyvest_primary.release_failed_goal_cancel_forfeit(
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
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  v_forfeit := piggyvest_primary.lock_goal_cancel_forfeit_for_proof(v_binding, proof);
  IF v_forfeit.id IS NULL THEN RETURN 'conflict'; END IF;
  IF v_forfeit.state = 'released' THEN RETURN 'duplicate'; END IF;
  IF v_forfeit.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  IF piggyvest_primary.release_goal_cancel_forfeit_row(v_forfeit.id) = 'needs_review' THEN
    RETURN 'conflict';
  END IF;
  RETURN 'released';
END;
$$;

-- 8. A customer leg that is released (before or after dispatch) takes its
-- unsent forfeit with it: interest is only ever forfeited for a cancel that
-- happened.
CREATE FUNCTION piggyvest_primary.release_unsent_goal_cancel_forfeit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     SET state = 'released'
   WHERE forfeit.cancel_operation_id = NEW.id AND forfeit.state = 'reserved';
  RETURN NEW;
END;
$$;
CREATE TRIGGER release_unsent_goal_cancel_forfeit
  AFTER UPDATE OF state ON piggyvest_primary.goal_cancel_operations
  FOR EACH ROW WHEN (NEW.state = 'released' AND OLD.state IS DISTINCT FROM 'released')
  EXECUTE FUNCTION piggyvest_primary.release_unsent_goal_cancel_forfeit();

-- A customer may not be deleted while a forfeit transfer is in flight:
-- settlement joins the live intent.
CREATE FUNCTION piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
    JOIN piggyvest_primary.onboarding_intents AS intent ON intent.id = forfeit.intent_id
    WHERE intent.customer_id = OLD.id AND forfeit.state = 'dispatched'
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with an in-flight goal interest forfeit' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER primary_goal_cancel_forfeit_block_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion();

-- 9. Grants.
REVOKE ALL ON FUNCTION
  piggyvest_primary.next_goal_cancel_forfeit_reference(uuid),
  piggyvest_primary.dispatch_goal_cancel_split(jsonb, uuid, bigint),
  piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint),
  piggyvest_primary.read_goal_cancel_amounts(jsonb, uuid),
  piggyvest_primary.settle_goal_cancel(uuid, text, jsonb),
  piggyvest_primary.release_goal_cancel_forfeit_row(uuid),
  piggyvest_primary.report_stuck_goal_cancel_forfeit(uuid, text),
  piggyvest_primary.claim_goal_cancel_forfeit(jsonb, uuid),
  piggyvest_primary.manage_goal_cancel_forfeit(jsonb, uuid, text),
  piggyvest_primary.assert_goal_cancel_evidence(uuid, text),
  piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid, text, uuid),
  piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid, text, text),
  piggyvest_primary.lock_goal_cancel_forfeit_for_proof(piggyvest_primary.integrations, jsonb),
  piggyvest_primary.settle_goal_cancel_forfeit(uuid, text, jsonb),
  piggyvest_primary.release_failed_goal_cancel_forfeit(uuid, text, jsonb),
  piggyvest_primary.release_unsent_goal_cancel_forfeit(),
  piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion()
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

GRANT EXECUTE ON FUNCTION piggyvest_primary.dispatch_goal_cancel_split(jsonb, uuid, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_cancel_amounts(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_goal_cancel_forfeit(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_cancel_forfeit(jsonb, uuid, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_cancel(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid, text, uuid)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid, text, text)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.settle_goal_cancel_forfeit(uuid, text, jsonb)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_failed_goal_cancel_forfeit(uuid, text, jsonb)
  TO piggyvest_primary_evidence;

COMMIT;
