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
  IF to_regclass('piggyvest_primary.paid_interest_receipts') IS NULL THEN
    RAISE EXCEPTION 'paid interest receipts missing; apply 20261007212100 first';
  END IF;
  IF to_regclass('savings_notifications.events') IS NULL THEN
    RAISE EXCEPTION 'savings notifications missing; apply 20260925130050 first';
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
-- held_reason: set when an attempt is released because PiggyVest held less
-- than the saved principal, because interest is owed with no interest
-- wallet set up, or because the principal alone is above the per-transfer
-- ceiling; while any such hold is uncleared no new cancel of the goal starts
-- (an operator clears it, see the runbook). held_alerted_at: set only after
-- a page about the hold was emitted; the daily sweep pages every hold whose
-- last page is missing or a day old, so a hold is never silent.
ALTER TABLE piggyvest_primary.goal_cancel_operations
  ADD COLUMN held_reason text
    CHECK (held_reason IS NULL
           OR held_reason IN ('provider_balance_below_principal', 'interest_wallet_missing',
                              'principal_above_transfer_limit'));
ALTER TABLE piggyvest_primary.goal_cancel_operations
  ADD COLUMN held_alerted_at timestamptz;
ALTER TABLE piggyvest_primary.goal_cancel_operations
  ADD COLUMN forfeited_interest_kobo bigint
    -- The whole interest forfeited, which may exceed the per-transfer ceiling
    -- (that part goes to review, see dispatch_goal_cancel_split).
    CHECK (forfeited_interest_kobo IS NULL OR forfeited_interest_kobo BETWEEN 0 AND 999999999999999);

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
  -- Set only AFTER a page about this forfeit was emitted (the caller
  -- acknowledges it: ack_goal_cancel_forfeit_alert_worker, or
  -- manage_goal_cancel_forfeit 'ack'), never when the alert is decided, so a
  -- crash or lost answer can not suppress the page. An unacknowledged review
  -- is paged by the daily sweep.
  alerted_at timestamptz,
  -- Stamped right before the single POST. A claimed (dispatched) forfeit
  -- without it was never sent, so it can always be handed back and retried.
  posted_at timestamptz,
  CONSTRAINT goal_cancel_forfeit_reference_key UNIQUE (reference),
  CHECK (source_wallet_id <> destination_wallet_id),
  CHECK (state = 'reserved' OR state = 'released' OR state = 'needs_review' OR dispatched_at IS NOT NULL),
  CHECK (state <> 'confirmed' OR provider_transaction_id IS NOT NULL)
);
-- At most one planned and one in-flight forfeit per cancel attempt. A cancel
-- can forfeit more than once: interest PiggyVest pays into the goal wallet
-- after the cancel is planned (section 8b) becomes another forfeit, and a
-- later plan merges into an unsent one.
CREATE UNIQUE INDEX goal_cancel_forfeit_one_live_idx
  ON piggyvest_primary.goal_cancel_interest_forfeits (cancel_operation_id, state)
  WHERE state IN ('reserved', 'dispatched');
CREATE UNIQUE INDEX goal_cancel_forfeit_provider_transaction_idx
  ON piggyvest_primary.goal_cancel_interest_forfeits (integration_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
-- Full (non-partial) index for the cancel-operation foreign key: the live
-- index above skips released rows.
CREATE INDEX goal_cancel_forfeit_cancel_operation_idx
  ON piggyvest_primary.goal_cancel_interest_forfeits (cancel_operation_id);
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
--   too_large           the principal alone is above the per-transfer
--                       ceiling; released
-- The ceiling applies to each transfer, not to the goal balance: interest
-- above it still lets the principal go, and the interest is recorded as a
-- forfeit in review (paged by the daily sweep), as late interest is.
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
    OR provider_balance_kobo NOT BETWEEN 1 AND 999999999999999 THEN
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
    UPDATE piggyvest_primary.goal_cancel_operations
       SET state = 'released', held_reason = 'provider_balance_below_principal'
     WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  END IF;
  v_principal := (v_current * 100)::bigint;
  v_interest := provider_balance_kobo - v_principal;
  IF v_principal > 9999999999 THEN
    -- One transfer can not carry it: released, nothing sent, and held so a
    -- person handles it (a retry can never succeed) instead of the customer
    -- looping on the refusal.
    UPDATE piggyvest_primary.goal_cancel_operations
       SET state = 'released', held_reason = 'principal_above_transfer_limit'
     WHERE id = v_operation.id;
    RETURN pg_catalog.jsonb_build_object('status', 'too_large');
  END IF;
  IF v_interest > 0 THEN
    SELECT forfeit.provider_wallet_id INTO v_wallet
      FROM piggyvest_primary.goal_interest_forfeit_wallets AS forfeit
     WHERE forfeit.integration_id = v_operation.integration_id AND forfeit.enabled
       AND forfeit.provider_wallet_id <> v_operation.source_wallet_id
       AND forfeit.provider_wallet_id <> v_operation.destination_wallet_id
       FOR SHARE;
    IF NOT FOUND THEN
      -- Held like a shortfall: a retry can not succeed until an operator sets
      -- up the interest wallet, so the customer is told it is under review
      -- rather than to try again (runbook: configure, then clear the hold).
      UPDATE piggyvest_primary.goal_cancel_operations
         SET state = 'released', held_reason = 'interest_wallet_missing'
       WHERE id = v_operation.id;
      RETURN pg_catalog.jsonb_build_object('status', 'forfeit_unavailable');
    END IF;
  END IF;
  v_now := pg_catalog.clock_timestamp();
  UPDATE piggyvest_primary.goal_cancel_operations
     SET state = 'dispatched', amount_kobo = v_principal, forfeited_interest_kobo = v_interest,
         dispatched_at = v_now
   WHERE id = v_operation.id;
  IF v_interest > 9999999999 THEN
    -- Above the per-transfer ceiling: recorded for review (paged by the
    -- daily sweep), never sent or truncated. The amount is the ceiling
    -- marker; forfeited_interest_kobo holds the real figure.
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
      'needs_review', piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
      v_operation.source_wallet_id, v_wallet, 9999999999, v_now);
  ELSIF v_interest > 0 THEN
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

-- issue_goal_cancel (20261103085004 definition): a goal whose PiggyVest
-- setup never finished (no savings destination) now answers
-- {"status":"not_set_up"} instead of raising, so the route can say so.
-- Everything else is unchanged; same signature, grants persist.
CREATE OR REPLACE FUNCTION piggyvest_primary.issue_goal_cancel(scope jsonb, goal_id uuid)
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
    -- The goal's PiggyVest setup never finished, so it holds no PiggyVest
    -- money and there is nothing to cancel here. An honest answer, never an
    -- error the customer reads as "check the status" of an attempt that was
    -- never made.
    RETURN pg_catalog.jsonb_build_object('status', 'not_set_up');
  END IF;
  SELECT live.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS live
   WHERE live.goal_id = v_goal.id AND live.state IN ('reserved', 'dispatched')
     FOR UPDATE;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'pending', 'operationId', v_operation.id);
  END IF;
  -- An attempt waiting for an operator blocks a new cancel until it is cleared.
  IF piggyvest_primary.goal_cancel_needs_review(v_goal.id) IS NOT FALSE
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS review
                WHERE review.goal_id = v_goal.id
                  AND (review.state = 'needs_review' OR review.held_reason IS NOT NULL)) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'needs_review');
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations AS funding
              WHERE funding.goal_id = v_goal.id AND funding.state IN ('reserved', 'dispatched')) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'busy');
  END IF;
  UPDATE piggyvest_primary.goal_cancel_operations AS stale SET state = 'released'
   WHERE stale.goal_id = v_goal.id AND stale.state = 'issued'
     AND stale.expires_at <= pg_catalog.clock_timestamp();
  -- The clock is read after every lock above (including the row locks the
  -- update just took) has been acquired.
  v_now := pg_catalog.clock_timestamp();
  SELECT fresh.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS fresh
   WHERE fresh.goal_id = v_goal.id AND fresh.state = 'issued' AND fresh.expires_at > v_now
     AND fresh.integration_id = (scope ->> 'integrationId')::uuid AND fresh.intent_id = v_intent_id
   ORDER BY fresh.issued_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO piggyvest_primary.goal_cancel_operations
      (id, integration_id, intent_id, goal_id, state, issued_at, expires_at)
    VALUES (pg_catalog.gen_random_uuid(), (scope ->> 'integrationId')::uuid, v_intent_id,
      v_goal.id, 'issued', v_now, v_now + interval '10 minutes')
    RETURNING * INTO v_operation;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'issued', 'operationId', v_operation.id, 'expiresAt', v_operation.expires_at);
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
  v_owed bigint;
  v_owed_wallet text;
  v_last_wallet text;
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
  -- Interest forfeited and not yet moved out is meant to still be in the goal
  -- wallet: every live forfeit leg, and the whole forfeited total less what
  -- has settled (which also covers interest held in review, such as interest
  -- above the per-transfer ceiling, whose row carries only a marker amount).
  -- Only the internal interest leg needs a person then, not the customer's
  -- cancel.
  SELECT GREATEST(
           COALESCE(pg_catalog.sum(forfeit.amount_kobo)
                      FILTER (WHERE forfeit.state IN ('reserved', 'dispatched')), 0),
           COALESCE(v_operation.forfeited_interest_kobo, 0)
             - COALESCE(pg_catalog.sum(forfeit.amount_kobo) FILTER (WHERE forfeit.state = 'confirmed'), 0))
    INTO v_expected_residual
    FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = v_operation.id;
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
  -- Interest paid after the dispatch is forfeited now that the cancel is
  -- confirmed: its "interest added" notice is voided (it was kept while the
  -- cancel could still fail).
  IF NOT v_review THEN
    UPDATE savings_notifications.events AS event
       SET voided_at = COALESCE(event.voided_at, pg_catalog.clock_timestamp())
      FROM piggyvest_primary.paid_interest_receipts AS receipt
     WHERE receipt.goal_id = v_operation.goal_id AND receipt.integration_id = v_operation.integration_id
       AND (receipt.financial_identity ->> 'paidAt') IS NOT NULL
       AND (receipt.financial_identity ->> 'paidAt')::timestamptz > v_operation.dispatched_at
       AND event.merchant_id = receipt.merchant_id AND event.customer_id = receipt.customer_id
       AND event.goal_id = receipt.goal_id
       AND event.event_key = 'primary-interest:' || receipt.integration_id::text || ':' || receipt.payout_id;
  END IF;
  -- A released attempt proven successful late: releasing it also released its
  -- unsent interest plan, so the interest still owed (the forfeited total less
  -- what settled or is still live) is planned again under a fresh reference,
  -- for the sweep or the next status check to send. Above the per-transfer
  -- ceiling it is recorded for review instead (paged by the sweep).
  IF v_late AND NOT v_review THEN
    SELECT COALESCE(v_operation.forfeited_interest_kobo, 0)
             - COALESCE(pg_catalog.sum(forfeit.amount_kobo)
                          FILTER (WHERE forfeit.state IN ('confirmed', 'reserved', 'dispatched')), 0),
           (SELECT wallet.provider_wallet_id FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
             WHERE wallet.integration_id = v_operation.integration_id),
           (SELECT last.destination_wallet_id FROM piggyvest_primary.goal_cancel_interest_forfeits AS last
             WHERE last.cancel_operation_id = v_operation.id ORDER BY last.reserved_at DESC LIMIT 1)
      INTO v_owed, v_owed_wallet, v_last_wallet
      FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     WHERE forfeit.cancel_operation_id = v_operation.id;
    v_owed_wallet := COALESCE(v_owed_wallet, v_last_wallet);
    IF v_owed > 0 AND v_owed_wallet IS NOT NULL AND v_owed_wallet <> v_operation.source_wallet_id THEN
      INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
        cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
        source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
      VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
        CASE WHEN v_owed <= 9999999999 THEN 'reserved' ELSE 'needs_review' END,
        piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
        v_operation.source_wallet_id, v_owed_wallet, LEAST(v_owed, 9999999999), v_now);
    END IF;
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
  v_review_id uuid;
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_released integer;
  v_wallet text;
  v_other piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = p_forfeit_id FOR UPDATE;
  SELECT pg_catalog.count(*) INTO v_released FROM piggyvest_primary.goal_cancel_interest_forfeits AS prior
   WHERE prior.cancel_operation_id = v_forfeit.cancel_operation_id AND prior.state = 'released'
     -- Only forfeits that were sent count (a rejection), never one that was
     -- merged away before sending.
     AND prior.dispatched_at IS NOT NULL;
  IF v_released >= 2 THEN
    -- The caller of this transition pages; not stamped, so a lost page is
    -- repeated (a claim or the daily sweep pages until one is acknowledged).
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'needs_review', alerted_at = NULL
     WHERE id = v_forfeit.id;
    RETURN 'needs_review';
  END IF;
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'released' WHERE id = v_forfeit.id;
  SELECT wallet.provider_wallet_id INTO v_wallet FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
   WHERE wallet.integration_id = v_forfeit.integration_id AND wallet.enabled;
  SELECT other.* INTO v_other FROM piggyvest_primary.goal_cancel_interest_forfeits AS other
   WHERE other.cancel_operation_id = v_forfeit.cancel_operation_id AND other.state = 'reserved'
     FOR UPDATE;
  IF FOUND AND v_other.amount_kobo + v_forfeit.amount_kobo > 9999999999 THEN
    -- The replacement can not merge under the per-transfer ceiling: it goes
    -- to review as its own row with its full amount (nothing dropped), and
    -- the plan already waiting stays sendable. The caller pages for this row
    -- and then acknowledges it, named in the answer; until then the daily
    -- sweep pages it, so a lost page is never silent.
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_forfeit.cancel_operation_id, v_forfeit.integration_id, v_forfeit.intent_id, v_forfeit.goal_id,
      'needs_review', piggyvest_primary.next_goal_cancel_forfeit_reference(v_forfeit.goal_id),
      v_forfeit.source_wallet_id, COALESCE(v_wallet, v_forfeit.destination_wallet_id),
      v_forfeit.amount_kobo, pg_catalog.clock_timestamp())
    RETURNING id INTO v_review_id;
    RETURN 'released_needs_review:' || v_review_id::text;
  END IF;
  IF FOUND THEN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET amount_kobo = v_other.amount_kobo + v_forfeit.amount_kobo
     WHERE id = v_other.id;
    RETURN 'released';
  END IF;
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

-- A stuck forfeit's claim answer with its id; "alert" while no page about it
-- has been acknowledged in the last day (a stuck forfeit, such as a
-- misconfigured interest wallet, is re-paged daily until it is fixed, never
-- paged once and then left silent). Nothing is stamped here: the caller acknowledges the
-- page after emitting it. Caller holds the row lock.
CREATE FUNCTION piggyvest_primary.report_stuck_goal_cancel_forfeit(p_forfeit_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_interest_forfeits
              WHERE id = p_forfeit_id
                AND (alerted_at IS NULL OR alerted_at < pg_catalog.clock_timestamp() - interval '1 day')) THEN
    RETURN pg_catalog.jsonb_build_object('status', p_status, 'forfeitId', p_forfeit_id, 'alert', true);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', p_status, 'forfeitId', p_forfeit_id);
END;
$$;

-- 6. Forfeit leg, authorizer side. Claims the attempt's planned forfeit for
-- its single POST, only once the customer's principal is CONFIRMED. Answers:
--   claimed  {forfeit: transfer details}   send it now, exactly once
--   pending  {forfeitId}                   already sent; read its status
--   waiting                                principal not confirmed yet
--   confirmed / needs_review / none        nothing to send
--   unavailable                            interest wallet no longer enabled
-- needs_review and unavailable carry the forfeitId, and "alert": true until
-- the caller acknowledges the page it emitted, so it pages once.
-- The claim itself, shared by the customer path and the worker sweep. The
-- caller has resolved the attempt's authority and holds the intent lock.
CREATE FUNCTION piggyvest_primary.claim_goal_cancel_forfeit_core(
  p_operation_id uuid,
  p_business_id text,
  p_provider_customer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_wallet text;
BEGIN
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = p_operation_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'none'); END IF;
  -- A claim that was never POSTed (no posted_at) and is older than ten
  -- minutes was abandoned before sending (a crash, or a hand-back that could
  -- not be written): hand it back, so it is retried instead of waiting
  -- forever on a transfer that does not exist.
  PERFORM piggyvest_primary.unclaim_goal_cancel_forfeit_row(stale.id, false)
     FROM piggyvest_primary.goal_cancel_interest_forfeits AS stale
    WHERE stale.cancel_operation_id = v_operation.id AND stale.state = 'dispatched'
      AND stale.posted_at IS NULL
      AND stale.dispatched_at < pg_catalog.clock_timestamp() - interval '10 minutes';
  -- In-flight first (read its status, never send twice), then unsent, then
  -- review; confirmed only when nothing else is left for this attempt.
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = v_operation.id
     AND forfeit.state IN ('reserved', 'dispatched', 'confirmed', 'needs_review')
   ORDER BY CASE forfeit.state WHEN 'dispatched' THEN 0 WHEN 'reserved' THEN 1
                               WHEN 'needs_review' THEN 2 ELSE 3 END, forfeit.reserved_at DESC
   LIMIT 1
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
  SELECT wallet.provider_wallet_id INTO v_wallet
    FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
   WHERE wallet.integration_id = v_forfeit.integration_id AND wallet.enabled
     AND wallet.provider_wallet_id <> v_forfeit.source_wallet_id
     AND wallet.provider_wallet_id <> v_operation.destination_wallet_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN piggyvest_primary.report_stuck_goal_cancel_forfeit(v_forfeit.id, 'unavailable');
  END IF;
  -- Nothing has been sent for a reserved forfeit, so it follows the wallet
  -- the operator has configured now (a rotation never strands it).
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET state = 'dispatched', dispatched_at = pg_catalog.clock_timestamp(),
         destination_wallet_id = v_wallet
   WHERE id = v_forfeit.id;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'forfeit', pg_catalog.jsonb_build_object(
      'operationId', v_forfeit.id, 'goalId', v_forfeit.goal_id, 'amountKobo', v_forfeit.amount_kobo,
      'sourceWalletId', v_forfeit.source_wallet_id,
      'destinationWalletId', v_wallet,
      'reference', v_forfeit.reference, 'businessId', p_business_id,
      'providerCustomerId', p_provider_customer_id));
END;
$$;

CREATE FUNCTION piggyvest_primary.claim_goal_cancel_forfeit(scope jsonb, operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  IF operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid goal cancel forfeit claim' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS op
                  WHERE op.id = claim_goal_cancel_forfeit.operation_id AND op.intent_id = v_intent_id
                    AND op.integration_id = (scope ->> 'integrationId')::uuid) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'none');
  END IF;
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_intent_id;
  RETURN piggyvest_primary.claim_goal_cancel_forfeit_core(
    operation_id, scope ->> 'businessId', v_intent.provider_customer_id);
END;
$$;

-- Hands a claimed forfeit back unsent (dispatched -> reserved, same
-- reference: nothing was POSTed under it). Used when the destination check
-- fails or can not run before the POST: retryable, never a rejection. Merges
-- with an unsent forfeit planned meanwhile. Answers 'unclaimed_first' while
-- no page about the forfeit has been acknowledged (the caller pages, then
-- acknowledges) and 'unclaimed' after that. Caller holds the intent lock.
CREATE FUNCTION piggyvest_primary.unclaim_goal_cancel_forfeit_row(p_forfeit_id uuid, p_page boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
  v_other piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = p_forfeit_id FOR UPDATE;
  -- Only a forfeit that was never POSTed can be handed back.
  IF NOT FOUND OR v_forfeit.state <> 'dispatched' OR v_forfeit.posted_at IS NOT NULL THEN
    RETURN 'not_released';
  END IF;
  SELECT other.* INTO v_other FROM piggyvest_primary.goal_cancel_interest_forfeits AS other
   WHERE other.cancel_operation_id = v_forfeit.cancel_operation_id AND other.state = 'reserved'
     FOR UPDATE;
  IF FOUND THEN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'released'
     WHERE id = v_other.id;
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = CASE WHEN v_forfeit.amount_kobo + v_other.amount_kobo <= 9999999999
                        THEN 'reserved' ELSE 'needs_review' END,
           dispatched_at = NULL,
           amount_kobo = CASE WHEN v_forfeit.amount_kobo + v_other.amount_kobo <= 9999999999
                              THEN v_forfeit.amount_kobo + v_other.amount_kobo ELSE v_forfeit.amount_kobo END
     WHERE id = v_forfeit.id;
    IF v_forfeit.amount_kobo + v_other.amount_kobo > 9999999999 THEN
      -- Not merged: the other plan stays as it was, this one goes to review
      -- unstamped, so the daily sweep pages the review (not a wallet page).
      UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET state = 'reserved' WHERE id = v_other.id;
      UPDATE piggyvest_primary.goal_cancel_interest_forfeits SET alerted_at = NULL WHERE id = v_forfeit.id;
      RETURN 'unclaimed';
    END IF;
  ELSE
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET state = 'reserved', dispatched_at = NULL
     WHERE id = v_forfeit.id;
  END IF;
  IF p_page AND (v_forfeit.alerted_at IS NULL OR v_forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day') THEN
    RETURN 'unclaimed_first';
  END IF;
  RETURN 'unclaimed';
END;
$$;

-- Stamps posted_at right before the single POST ('posting'); without it a
-- claimed forfeit is known never to have been sent. Caller holds the lock.
CREATE FUNCTION piggyvest_primary.mark_goal_cancel_forfeit_posting_row(p_forfeit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET posted_at = pg_catalog.clock_timestamp(),
         -- A page about an earlier failed wallet check is spent; this
         -- transfer must still be able to raise its own overdue page.
         alerted_at = NULL
   WHERE id = p_forfeit_id AND state = 'dispatched' AND posted_at IS NULL;
  IF FOUND THEN RETURN 'posting'; END IF;
  RETURN 'not_released';
END;
$$;

-- 'release': dispatched -> released (or needs_review on the third), after a
-- definitive provider rejection with no transfer on record for the reference.
-- Returns the new state ('released' or 'needs_review', so the caller pages on
-- the cap), or 'not_released' when the forfeit was not dispatched.
-- 'unclaim': hands an unsent claimed forfeit back (answers 'unclaimed').
-- 'ack': records that a page about this forfeit was emitted (answers 'acked',
-- or 'not_released' when there was nothing to acknowledge).
CREATE FUNCTION piggyvest_primary.manage_goal_cancel_forfeit(scope jsonb, forfeit_id uuid, action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_forfeit piggyvest_primary.goal_cancel_interest_forfeits%ROWTYPE;
BEGIN
  IF forfeit_id IS NULL OR action IS NULL OR action NOT IN ('release', 'unclaim', 'posting', 'ack') THEN
    RAISE EXCEPTION 'invalid goal cancel forfeit transition' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_intent_id::text, 0));
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = manage_goal_cancel_forfeit.forfeit_id AND forfeit.intent_id = v_intent_id
     AND forfeit.integration_id = (scope ->> 'integrationId')::uuid
     FOR UPDATE;
  IF FOUND AND action = 'ack' THEN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET alerted_at = pg_catalog.clock_timestamp()
     WHERE id = v_forfeit.id AND (alerted_at IS NULL OR alerted_at < pg_catalog.clock_timestamp() - interval '1 day');
    IF FOUND THEN RETURN 'acked'; END IF;
    RETURN 'not_released';
  END IF;
  IF NOT FOUND OR v_forfeit.state <> 'dispatched' OR action = 'ack' THEN RETURN 'not_released'; END IF;
  IF action = 'unclaim' THEN
    RETURN piggyvest_primary.unclaim_goal_cancel_forfeit_row(v_forfeit.id, true);
  END IF;
  IF action = 'posting' THEN
    RETURN piggyvest_primary.mark_goal_cancel_forfeit_posting_row(v_forfeit.id);
  END IF;
  RETURN piggyvest_primary.release_goal_cancel_forfeit_row(v_forfeit.id);
END;
$$;

-- 6b. Forfeit leg, worker side (authorizer login with the integration's
-- savings authority, no customer scope): the scheduled sweep that sends
-- forfeits nobody's status check picked up (for example a cancel confirmed by
-- the outflow webhook after the customer closed the app), and reports
-- in-flight forfeits so they are settled or paged.
CREATE FUNCTION piggyvest_primary.assert_goal_cancel_worker(integration_id uuid, environment text)
RETURNS piggyvest_primary.integrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  SELECT candidate.* INTO v_binding FROM piggyvest_primary.integrations AS candidate
    JOIN piggyvest_primary.savings_authorities AS authority ON authority.integration_id = candidate.id
   WHERE candidate.id = assert_goal_cancel_worker.integration_id
     AND candidate.environment = assert_goal_cancel_worker.environment
     AND candidate.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
     FOR SHARE OF candidate, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forfeit worker authority unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_binding;
END;
$$;

-- Up to p_limit cancel attempts whose forfeit needs the sweep: reserved behind
-- a confirmed principal (to send), or dispatched (to settle). A forfeit still
-- dispatched a day after it was sent (or a plan in review nobody was paged
-- about) is returned with "alert": true until the sweep acknowledges the page
-- (ack_goal_cancel_forfeit_alert_worker) after emitting it, so a lost answer
-- or a crash before the page can never suppress it. Unsent and in-flight
-- work are taken in turn (each lane oldest first, already-paged stuck rows
-- last), so neither old stuck rows nor a backlog of unsent ones can starve
-- the rest.
CREATE FUNCTION piggyvest_primary.list_goal_cancel_forfeit_work(
  integration_id uuid,
  environment text,
  p_limit integer,
  p_include_unsent boolean
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
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_include_unsent IS NULL THEN
    RAISE EXCEPTION 'invalid forfeit work limit' USING ERRCODE = '22023';
  END IF;
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  WITH candidates AS (
    -- Unsent and in-flight work are ranked in their own lanes and taken in
    -- turn, so neither can fill the whole batch and starve the other.
    SELECT pg_catalog.row_number() OVER (
             PARTITION BY forfeit.state
             ORDER BY (forfeit.alerted_at IS NOT NULL), forfeit.reserved_at, forfeit.id) AS lane_rank,
           forfeit.id, forfeit.cancel_operation_id, forfeit.state,
           -- Paged again each day it stays stuck: an acknowledgement a day
           -- old counts as no page.
           forfeit.state = 'dispatched'
             AND (forfeit.alerted_at IS NULL OR forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day')
             AND forfeit.dispatched_at < pg_catalog.clock_timestamp() - interval '1 day'
           -- A plan that went to review without anyone being paged (an
           -- over-ceiling merge from a late payout) is paged by the sweep.
           OR (forfeit.state = 'needs_review'
               AND (forfeit.alerted_at IS NULL OR forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day')) AS overdue
      FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
      JOIN piggyvest_primary.goal_cancel_operations AS cancel ON cancel.id = forfeit.cancel_operation_id
     WHERE forfeit.integration_id = v_binding.id
       -- While new transfers are off only in-flight work is listed, so a
       -- backlog of unsent forfeits can not crowd out settling sent ones.
       AND (forfeit.state = 'dispatched'
            OR (forfeit.state = 'needs_review'
                AND (forfeit.alerted_at IS NULL OR forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day'))
            OR (p_include_unsent AND forfeit.state = 'reserved' AND cancel.state = 'confirmed'))
  ), work AS (
    SELECT pg_catalog.row_number() OVER (
             ORDER BY candidates.lane_rank, (candidates.state = 'reserved') DESC) AS rank,
           candidates.*
      FROM candidates
     ORDER BY candidates.lane_rank, (candidates.state = 'reserved') DESC
     LIMIT p_limit
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'operationId', work.cancel_operation_id, 'forfeitId', work.id, 'state', work.state,
      'alert', work.overdue) ORDER BY work.rank), '[]'::jsonb)
    INTO v_result FROM work;
  RETURN v_result;
END;
$$;

-- Records that the sweep has emitted the page for this one overdue or
-- unpaged forfeit (the listed forfeitId, never its siblings, so a sibling that
-- became alertable meanwhile is still paged), so it is not paged again.
-- Called only after the page; true when something was acknowledged.
CREATE FUNCTION piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(
  integration_id uuid,
  environment text,
  forfeit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     SET alerted_at = pg_catalog.clock_timestamp()
   WHERE forfeit.id = ack_goal_cancel_forfeit_alert_worker.forfeit_id
     AND forfeit.integration_id = v_binding.id
     AND (forfeit.alerted_at IS NULL OR forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day');
  RETURN FOUND;
END;
$$;

CREATE FUNCTION piggyvest_primary.claim_goal_cancel_forfeit_worker(
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
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  SELECT op.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS op
   WHERE op.id = claim_goal_cancel_forfeit_worker.operation_id AND op.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'none'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT intent.* INTO v_intent FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_operation.intent_id AND intent.integration_id = v_binding.id;
  IF NOT FOUND OR v_intent.provider_customer_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'none');
  END IF;
  RETURN piggyvest_primary.claim_goal_cancel_forfeit_core(
    v_operation.id, v_binding.business_id, v_intent.provider_customer_id);
END;
$$;

CREATE FUNCTION piggyvest_primary.release_goal_cancel_forfeit_worker(
  integration_id uuid,
  environment text,
  forfeit_id uuid
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
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = release_goal_cancel_forfeit_worker.forfeit_id AND forfeit.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'not_released'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_forfeit.intent_id::text, 0));
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = v_forfeit.id FOR UPDATE;
  IF v_forfeit.state <> 'dispatched' THEN RETURN 'not_released'; END IF;
  RETURN piggyvest_primary.release_goal_cancel_forfeit_row(v_forfeit.id);
END;
$$;

CREATE FUNCTION piggyvest_primary.unclaim_goal_cancel_forfeit_worker(
  integration_id uuid,
  environment text,
  forfeit_id uuid
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
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = unclaim_goal_cancel_forfeit_worker.forfeit_id AND forfeit.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'not_released'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_forfeit.intent_id::text, 0));
  RETURN piggyvest_primary.unclaim_goal_cancel_forfeit_row(v_forfeit.id, true);
END;
$$;

CREATE FUNCTION piggyvest_primary.mark_goal_cancel_forfeit_posting_worker(
  integration_id uuid,
  environment text,
  forfeit_id uuid
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
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  SELECT forfeit.* INTO v_forfeit FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.id = mark_goal_cancel_forfeit_posting_worker.forfeit_id AND forfeit.integration_id = v_binding.id;
  IF NOT FOUND THEN RETURN 'not_released'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_forfeit.intent_id::text, 0));
  RETURN piggyvest_primary.mark_goal_cancel_forfeit_posting_row(v_forfeit.id);
END;
$$;

-- Holds the sweep must page: released attempts holding new cancels of
-- their goal whose last acknowledged page is missing or a day old, so an
-- operator-only hold is never silent (the submit path pages at once too).
CREATE FUNCTION piggyvest_primary.list_goal_cancel_holds_worker(integration_id uuid, environment text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
  v_result jsonb;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'operationId', hold.id, 'reason', hold.held_reason) ORDER BY hold.issued_at), '[]'::jsonb)
    INTO v_result
    FROM (SELECT op.id, op.held_reason, op.issued_at
            FROM piggyvest_primary.goal_cancel_operations AS op
           WHERE op.integration_id = v_binding.id AND op.held_reason IS NOT NULL
             AND (op.held_alerted_at IS NULL
                  OR op.held_alerted_at < pg_catalog.clock_timestamp() - interval '1 day')
           ORDER BY op.issued_at LIMIT 50) AS hold;
  RETURN v_result;
END;
$$;

-- Records an emitted page about a hold (called only after the page).
CREATE FUNCTION piggyvest_primary.ack_goal_cancel_hold_row(p_operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE piggyvest_primary.goal_cancel_operations
     SET held_alerted_at = pg_catalog.clock_timestamp()
   WHERE id = p_operation_id AND held_reason IS NOT NULL
     AND (held_alerted_at IS NULL OR held_alerted_at < pg_catalog.clock_timestamp() - interval '1 day');
  RETURN FOUND;
END;
$$;

CREATE FUNCTION piggyvest_primary.ack_goal_cancel_hold_worker(
  integration_id uuid,
  environment text,
  operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_worker(integration_id, environment);
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS op
                  WHERE op.id = ack_goal_cancel_hold_worker.operation_id
                    AND op.integration_id = v_binding.id) THEN
    RETURN false;
  END IF;
  RETURN piggyvest_primary.ack_goal_cancel_hold_row(operation_id);
END;
$$;

-- The submit path's acknowledgement, under the customer's own scope.
CREATE FUNCTION piggyvest_primary.ack_goal_cancel_hold(scope jsonb, operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
BEGIN
  IF operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid goal cancel hold acknowledgement' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_cancel_operations AS op
                  WHERE op.id = ack_goal_cancel_hold.operation_id AND op.intent_id = v_intent_id
                    AND op.integration_id = (scope ->> 'integrationId')::uuid) THEN
    RETURN false;
  END IF;
  RETURN piggyvest_primary.ack_goal_cancel_hold_row(operation_id);
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
     AND forfeit.integration_id = v_binding.id
     -- A released forfeit that WAS sent may still succeed late; reading it
     -- lets reconciliation see that (settlement then pages, never settles).
     AND (forfeit.state = 'dispatched' OR (forfeit.state = 'released' AND forfeit.dispatched_at IS NOT NULL));
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
     AND (forfeit.state = 'dispatched' OR (forfeit.state = 'released' AND forfeit.dispatched_at IS NOT NULL));
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
  v_frozen text;
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
    -- replacement was planned) is never settled automatically. The money has
    -- moved, so an unsent replacement is frozen for review in the same
    -- transaction: neither the sweep nor a status check may send it again.
    IF v_forfeit.state = 'released' AND v_forfeit.dispatched_at IS NOT NULL THEN
      -- Any live replacement, sent or not: an unsent one must not be sent, and
      -- a sent one must not be settled or replaced automatically (that could
      -- move the same interest twice). Paged by the caller (conflict), and by
      -- the daily sweep until a page is acknowledged.
      -- The frozen rows are named in the answer ('conflict:<id>[,<id>]'), so
      -- the caller acknowledges each after paging this one incident.
      WITH frozen AS (
        UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS replacement
           SET state = 'needs_review', alerted_at = NULL
         WHERE replacement.cancel_operation_id = v_forfeit.cancel_operation_id
           AND replacement.state IN ('reserved', 'dispatched')
        RETURNING replacement.id
      )
      SELECT pg_catalog.string_agg(frozen.id::text, ',' ORDER BY frozen.id::text) INTO v_frozen FROM frozen;
      -- The old row itself records the verified success (in review), so a
      -- redelivery of the same record is a duplicate and pages no one again.
      UPDATE piggyvest_primary.goal_cancel_interest_forfeits
         SET state = 'needs_review', provider_transaction_id = proof ->> 'providerTransactionId',
             settled_at = pg_catalog.clock_timestamp(), alerted_at = NULL
       WHERE id = v_forfeit.id;
    END IF;
    IF v_frozen IS NOT NULL THEN RETURN 'conflict:' || v_frozen; END IF;
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
  -- Money left in the goal wallet is expected only for this cancel's
  -- interest not yet moved out: its other planned or in-flight forfeits, and
  -- the whole forfeited total less what has settled (this transfer included),
  -- which also covers interest held in review (an over-ceiling sibling's row
  -- carries only a marker amount; the total carries the real figure).
  SELECT COALESCE((proof ->> 'residualKobo')::bigint, 0) > GREATEST(
           COALESCE(pg_catalog.sum(other.amount_kobo)
                      FILTER (WHERE other.id <> v_forfeit.id AND other.state IN ('reserved', 'dispatched')), 0),
           COALESCE(cancel.forfeited_interest_kobo, 0) - v_forfeit.amount_kobo
             - COALESCE(pg_catalog.sum(other.amount_kobo)
                          FILTER (WHERE other.id <> v_forfeit.id AND other.state = 'confirmed'), 0))
    INTO v_review
    FROM piggyvest_primary.goal_cancel_operations AS cancel
    LEFT JOIN piggyvest_primary.goal_cancel_interest_forfeits AS other
      ON other.cancel_operation_id = cancel.id
   WHERE cancel.id = v_forfeit.cancel_operation_id
   GROUP BY cancel.forfeited_interest_kobo;
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits
     SET state = CASE WHEN v_review THEN 'needs_review' ELSE 'confirmed' END,
         provider_transaction_id = proof ->> 'providerTransactionId',
         settled_at = pg_catalog.clock_timestamp(),
         -- The caller pages this review (conflict); the daily sweep pages it
         -- again until a page is acknowledged.
         alerted_at = CASE WHEN v_review THEN NULL ELSE alerted_at END
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

-- Records that the evidence side emitted a page about this forfeit (a
-- settlement it answered 'conflict' for), so the daily sweep does not page
-- the same review again. Called only after the page; true when something was
-- acknowledged.
CREATE FUNCTION piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(
  integration_id uuid,
  environment text,
  forfeit_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     SET alerted_at = pg_catalog.clock_timestamp()
   WHERE forfeit.id = ack_goal_cancel_forfeit_alert_evidence.forfeit_id
     AND forfeit.integration_id = v_binding.id
     AND (forfeit.alerted_at IS NULL OR forfeit.alerted_at < pg_catalog.clock_timestamp() - interval '1 day');
  RETURN FOUND;
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
  v_outcome text;
BEGIN
  v_binding := piggyvest_primary.assert_goal_cancel_evidence(integration_id, environment);
  v_forfeit := piggyvest_primary.lock_goal_cancel_forfeit_for_proof(v_binding, proof);
  IF v_forfeit.id IS NULL THEN RETURN 'conflict'; END IF;
  IF v_forfeit.state = 'released' THEN RETURN 'duplicate'; END IF;
  IF v_forfeit.state <> 'dispatched' THEN RETURN 'conflict'; END IF;
  -- Either review outcome (the third rejection, or a replacement that could
  -- not merge under the ceiling) answers conflict, which pages.
  v_outcome := piggyvest_primary.release_goal_cancel_forfeit_row(v_forfeit.id);
  IF v_outcome = 'needs_review' THEN RETURN 'conflict'; END IF;
  -- A replacement that went to review as its own row: named, so the caller
  -- acknowledges that row after paging ('conflict:<forfeit id>').
  IF v_outcome LIKE 'released_needs_review:%' THEN
    RETURN 'conflict:' || pg_catalog.substr(v_outcome, pg_catalog.char_length('released_needs_review:') + 1);
  END IF;
  RETURN 'released';
END;
$$;

-- 8. A customer leg that is released (before or after dispatch), or whose
-- review an operator clears ('reviewed': the operator resolves what the goal
-- wallet still holds, and a later cancel plans its own forfeit), takes its
-- unsent forfeit with it: interest is only ever forfeited automatically for a
-- cancel that was confirmed.
CREATE FUNCTION piggyvest_primary.release_unsent_goal_cancel_forfeit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Unsent plans, including one already moved to review and one claimed but
  -- never posted (no posted_at: its single POST has not been made, and the
  -- posting mark takes the same customer lock, so it can not start after
  -- this), are released: interest is only ever forfeited for a cancel that
  -- happened, and nothing is left stranded behind a released cancel.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     SET state = 'released'
   WHERE forfeit.cancel_operation_id = NEW.id
     AND (forfeit.state = 'reserved'
          OR (forfeit.state = 'needs_review' AND forfeit.dispatched_at IS NULL)
          OR (forfeit.state = 'dispatched' AND forfeit.posted_at IS NULL));
  RETURN NEW;
END;
$$;
CREATE TRIGGER release_unsent_goal_cancel_forfeit
  AFTER UPDATE OF state ON piggyvest_primary.goal_cancel_operations
  FOR EACH ROW WHEN (NEW.state IN ('released', 'reviewed') AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION piggyvest_primary.release_unsent_goal_cancel_forfeit();

-- 8a. The customer's Earnings never include interest forfeited by an early
-- cancel: each goal's paid interest (net of provider reversals, as before)
-- less the interest forfeited by its confirmed cancel (the cancel's
-- forfeited total, final for the customer as soon as the principal confirms,
-- whatever the internal interest transfer's state), never below zero. Same signature, so
-- its grants (none beyond the owner) persist through CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION piggyvest_primary.customer_paid_interest(p_merchant uuid,p_customer uuid)
RETURNS TABLE(goal_id uuid,amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT paid.goal_id,
         GREATEST(0, paid.amount - COALESCE((
           SELECT sum(cancel.forfeited_interest_kobo)::numeric
             FROM piggyvest_primary.goal_cancel_operations cancel
             -- Production cancels only, bound to this merchant, like the
             -- receipts below: a sandbox cancel never touches real Earnings.
             JOIN piggyvest_primary.integrations cancel_integration
               ON cancel_integration.id=cancel.integration_id
              AND cancel_integration.environment='production'
              AND cancel_integration.merchant_id=p_merchant
            WHERE cancel.goal_id=paid.goal_id AND cancel.state='confirmed'), 0))
  FROM (
    SELECT receipt.goal_id,sum(receipt.net_kobo-coalesce(reversal.amount,0))::numeric AS amount
    FROM piggyvest_primary.paid_interest_receipts receipt
    JOIN piggyvest_primary.integrations integration ON integration.id=receipt.integration_id AND integration.environment='production'
      AND integration.merchant_id=receipt.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=receipt.goal_id AND goal.merchant_id=receipt.merchant_id AND goal.customer_id=receipt.customer_id
    LEFT JOIN LATERAL (SELECT sum(amount_kobo)::numeric AS amount FROM piggyvest_primary.paid_interest_reversals
      WHERE integration_id=receipt.integration_id AND payout_id=receipt.payout_id) reversal ON true
    WHERE receipt.merchant_id=p_merchant AND receipt.customer_id=p_customer
    GROUP BY receipt.goal_id
  ) paid;
$$;

-- 8b. Interest PiggyVest pays into a goal wallet after an early cancel was
-- dispatched or confirmed is forfeited too: each such payout plans (or merges
-- into) an unsent forfeit of the cancel, which the sweep sends once the
-- principal is confirmed. Never raises: a payout is never refused because of
-- this; with no interest wallet ever configured (a cancel that owed no
-- interest) nothing is planned and the payout stays in the goal wallet. The
-- plan is made under the customer's savings lock, the same lock every other
-- forfeit insert holds, so two plans can not pick the same reference; and
-- should the insert still fail, the payout is recorded anyway (only the plan
-- is skipped; the daily reconciliation shows the interest left behind).
CREATE FUNCTION piggyvest_primary.plan_forfeit_for_late_goal_interest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_planned bigint;
  v_operation piggyvest_primary.goal_cancel_operations%ROWTYPE;
  v_wallet text;
  v_paid_at timestamptz;
BEGIN
  IF NEW.net_kobo IS NULL OR NEW.net_kobo < 1 THEN RETURN NEW; END IF;
  SELECT cancel.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS cancel
   WHERE cancel.goal_id = NEW.goal_id AND cancel.integration_id = NEW.integration_id
     AND cancel.state IN ('dispatched', 'confirmed')
   ORDER BY cancel.dispatched_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Serialize with the cancel's own transitions (release, settlement) on the
  -- customer's savings lock, then re-read it: a cancel released meanwhile
  -- gets no new forfeit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || v_operation.intent_id::text, 0));
  SELECT cancel.* INTO v_operation FROM piggyvest_primary.goal_cancel_operations AS cancel
   WHERE cancel.id = v_operation.id AND cancel.state IN ('dispatched', 'confirmed')
     FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Only interest PiggyVest paid AFTER the cancel read the balance is new:
  -- anything paid before is already inside the planned forfeit (the split was
  -- sized from that balance), so counting it again would over-forfeit. A
  -- payout with no provider time, or one paid in the moment between the read
  -- and the dispatch, is left to the settlement residual check (review), never
  -- added twice.
  -- The customer must not be told interest was added to a goal they have
  -- cancelled, whenever PiggyVest paid it (a delayed record of interest paid
  -- before the cancel was already forfeited by the split). While the principal is still in flight the notice stays (the
  -- cancel may yet fail and the interest stay theirs); settle_goal_cancel
  -- voids it once the cancel is confirmed. This trigger runs after the
  -- notification trigger, by name.
  IF v_operation.state = 'confirmed' THEN
    UPDATE savings_notifications.events AS event
       SET voided_at = COALESCE(event.voided_at, pg_catalog.clock_timestamp())
     WHERE event.merchant_id = NEW.merchant_id AND event.customer_id = NEW.customer_id
       AND event.goal_id = NEW.goal_id
       AND event.event_key = 'primary-interest:' || NEW.integration_id::text || ':' || NEW.payout_id;
  END IF;
  BEGIN
    v_paid_at := (NEW.financial_identity ->> 'paidAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_paid_at := NULL;
  END;
  IF v_paid_at IS NULL OR v_paid_at <= v_operation.dispatched_at THEN RETURN NEW; END IF;
  SELECT wallet.provider_wallet_id INTO v_wallet FROM piggyvest_primary.goal_interest_forfeit_wallets AS wallet
   WHERE wallet.integration_id = v_operation.integration_id;
  BEGIN
  IF NOT FOUND OR v_wallet = v_operation.source_wallet_id
    OR v_wallet = v_operation.destination_wallet_id THEN
    -- No usable interest wallet (a cancel that owed no interest never needed
    -- one): the payout is still forfeited, recorded for review so the sweep
    -- pages it, with a placeholder destination that can never be sent to
    -- (review rows are never claimed for sending).
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
      'needs_review', piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
      v_operation.source_wallet_id, 'interest-wallet-not-configured',
      LEAST(NEW.net_kobo, 9999999999), pg_catalog.clock_timestamp());
  ELSE
  SELECT forfeit.amount_kobo INTO v_planned FROM piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
   WHERE forfeit.cancel_operation_id = v_operation.id AND forfeit.state = 'reserved'
     FOR UPDATE;
  IF NEW.net_kobo > 9999999999 OR COALESCE(v_planned, 0) + NEW.net_kobo > 9999999999 THEN
    -- Above the per-transfer ceiling, alone or merged into the unsent plan:
    -- recorded for review as its own row (paged by the daily sweep until
    -- acknowledged), never truncated or dropped; the unsent plan stays
    -- sendable. Above the ceiling on its own, the amount is the ceiling marker
    -- and the receipt (and the cancel's forfeited total) holds the real figure.
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
      'needs_review', piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
      v_operation.source_wallet_id, v_wallet, LEAST(NEW.net_kobo, 9999999999), pg_catalog.clock_timestamp());
  ELSIF v_planned IS NOT NULL THEN
    UPDATE piggyvest_primary.goal_cancel_interest_forfeits
       SET amount_kobo = amount_kobo + NEW.net_kobo
     WHERE cancel_operation_id = v_operation.id AND state = 'reserved';
  ELSE
    INSERT INTO piggyvest_primary.goal_cancel_interest_forfeits (
      cancel_operation_id, integration_id, intent_id, goal_id, state, reference,
      source_wallet_id, destination_wallet_id, amount_kobo, reserved_at)
    VALUES (v_operation.id, v_operation.integration_id, v_operation.intent_id, v_operation.goal_id,
      'reserved', piggyvest_primary.next_goal_cancel_forfeit_reference(v_operation.goal_id),
      v_operation.source_wallet_id, v_wallet, NEW.net_kobo, pg_catalog.clock_timestamp());
  END IF;
  END IF;
  -- The cancel's forfeited total (what the app shows as interest not
  -- refunded) includes this late payout too, never only the dispatch-time
  -- figure.
  UPDATE piggyvest_primary.goal_cancel_operations
     SET forfeited_interest_kobo = LEAST(999999999999999,
           COALESCE(forfeited_interest_kobo, 0) + NEW.net_kobo)
   WHERE id = v_operation.id;
  EXCEPTION WHEN unique_violation OR check_violation THEN
    -- Never refuse the payout over the forfeit plan.
    NULL;
  END;
  RETURN NEW;
END;
$$;
-- Named to sort after primary_paid_interest_notification (same timing), so
-- the notice it voids already exists.
CREATE TRIGGER primary_paid_interest_post_cancel_forfeit
  AFTER INSERT ON piggyvest_primary.paid_interest_receipts
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.plan_forfeit_for_late_goal_interest();

-- Interest PiggyVest reverses is no longer in the goal wallet: an unsent
-- forfeit of the goal's live cancel goes to review (see below). A forfeit
-- already sent is not touched: if the money is short PiggyVest refuses it,
-- and the third refusal goes to review.
CREATE FUNCTION piggyvest_primary.reduce_forfeit_for_reversed_goal_interest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_goal_id uuid;
BEGIN
  SELECT receipt.goal_id INTO v_goal_id FROM piggyvest_primary.paid_interest_receipts AS receipt
   WHERE receipt.integration_id = NEW.integration_id AND receipt.payout_id = NEW.payout_id;
  IF NOT FOUND OR NEW.amount_kobo IS NULL OR NEW.amount_kobo < 1 THEN RETURN NEW; END IF;
  -- A plan merges payouts and the split's own interest, so which of them a
  -- reversal belongs to can not be told from here: the unsent plan is never
  -- shrunk or released automatically, it goes to review (paged once by the
  -- daily sweep) and a person sizes it. Nothing already sent is touched.
  UPDATE piggyvest_primary.goal_cancel_interest_forfeits AS forfeit
     SET state = 'needs_review', alerted_at = NULL
    FROM piggyvest_primary.goal_cancel_operations AS cancel
   WHERE forfeit.cancel_operation_id = cancel.id
     -- Including one claimed but not yet posted: its posting mark then finds
     -- it in review and nothing is sent (the row lock orders the two).
     AND (forfeit.state = 'reserved' OR (forfeit.state = 'dispatched' AND forfeit.posted_at IS NULL))
     AND cancel.goal_id = v_goal_id AND cancel.integration_id = NEW.integration_id
     AND cancel.state IN ('dispatched', 'confirmed');
  RETURN NEW;
END;
$$;
CREATE TRIGGER reduce_forfeit_for_reversed_goal_interest
  AFTER INSERT ON piggyvest_primary.paid_interest_reversals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.reduce_forfeit_for_reversed_goal_interest();

-- A customer may not be deleted while a forfeit is planned or in flight:
-- sending and settlement join the live intent and customer.
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
    WHERE intent.customer_id = OLD.id AND forfeit.state IN ('reserved', 'dispatched')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with an unsettled goal interest forfeit' USING ERRCODE = 'P0001';
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
  piggyvest_primary.issue_goal_cancel(jsonb, uuid),
  piggyvest_primary.dispatch_goal_cancel_split(jsonb, uuid, bigint),
  piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint),
  piggyvest_primary.read_goal_cancel_amounts(jsonb, uuid),
  piggyvest_primary.settle_goal_cancel(uuid, text, jsonb),
  piggyvest_primary.release_goal_cancel_forfeit_row(uuid),
  piggyvest_primary.report_stuck_goal_cancel_forfeit(uuid, text),
  piggyvest_primary.claim_goal_cancel_forfeit(jsonb, uuid),
  piggyvest_primary.claim_goal_cancel_forfeit_core(uuid, text, text),
  piggyvest_primary.assert_goal_cancel_worker(uuid, text),
  piggyvest_primary.list_goal_cancel_forfeit_work(uuid, text, integer, boolean),
  piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(uuid, text, uuid),
  piggyvest_primary.list_goal_cancel_holds_worker(uuid, text),
  piggyvest_primary.ack_goal_cancel_hold_row(uuid),
  piggyvest_primary.ack_goal_cancel_hold_worker(uuid, text, uuid),
  piggyvest_primary.ack_goal_cancel_hold(jsonb, uuid),
  piggyvest_primary.claim_goal_cancel_forfeit_worker(uuid, text, uuid),
  piggyvest_primary.release_goal_cancel_forfeit_worker(uuid, text, uuid),
  piggyvest_primary.unclaim_goal_cancel_forfeit_worker(uuid, text, uuid),
  piggyvest_primary.unclaim_goal_cancel_forfeit_row(uuid, boolean),
  piggyvest_primary.mark_goal_cancel_forfeit_posting_row(uuid),
  piggyvest_primary.mark_goal_cancel_forfeit_posting_worker(uuid, text, uuid),
  piggyvest_primary.manage_goal_cancel_forfeit(jsonb, uuid, text),
  piggyvest_primary.assert_goal_cancel_evidence(uuid, text),
  piggyvest_primary.read_dispatched_goal_cancel_forfeit(uuid, text, uuid),
  piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference(uuid, text, text),
  piggyvest_primary.lock_goal_cancel_forfeit_for_proof(piggyvest_primary.integrations, jsonb),
  piggyvest_primary.settle_goal_cancel_forfeit(uuid, text, jsonb),
  piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(uuid, text, uuid),
  piggyvest_primary.release_failed_goal_cancel_forfeit(uuid, text, jsonb),
  piggyvest_primary.release_unsent_goal_cancel_forfeit(),
  piggyvest_primary.plan_forfeit_for_late_goal_interest(),
  piggyvest_primary.reduce_forfeit_for_reversed_goal_interest(),
  piggyvest_primary.block_in_flight_goal_cancel_forfeit_customer_deletion()
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_authorizer, piggyvest_primary_evidence;

GRANT EXECUTE ON FUNCTION piggyvest_primary.dispatch_goal_cancel_split(jsonb, uuid, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.issue_goal_cancel(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_cancel(jsonb, uuid, text, bigint)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_cancel_amounts(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_goal_cancel_forfeit(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.manage_goal_cancel_forfeit(jsonb, uuid, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.list_goal_cancel_forfeit_work(uuid, text, integer, boolean)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.ack_goal_cancel_forfeit_alert_worker(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.list_goal_cancel_holds_worker(uuid, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.ack_goal_cancel_hold_worker(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.ack_goal_cancel_hold(jsonb, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_goal_cancel_forfeit_worker(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.release_goal_cancel_forfeit_worker(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.unclaim_goal_cancel_forfeit_worker(uuid, text, uuid)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.mark_goal_cancel_forfeit_posting_worker(uuid, text, uuid)
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
GRANT EXECUTE ON FUNCTION piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence(uuid, text, uuid)
  TO piggyvest_primary_evidence;

COMMIT;
