-- PIN checks on PiggyVest goal funding, cancel and complete (dark).
--
-- Adds three proof purposes (goal_fund, goal_cancel, goal_complete) and the
-- two server-side places that spend a PIN proof for them:
--
--  * piggyvest_primary.reserve_savings_with_pin: reserves a goal funding
--    transfer and spends the PIN proof in the SAME transaction. If the proof
--    is not spent (missing, invalid, mismatch, used, expired or unavailable)
--    the reservation is rolled back and the caller gets pin_refused, so no
--    reservation can exist without a spent proof. A replay of an operation
--    that is already reserved, pending or confirmed needs no new proof.
--  * piggyvest_primary.consume_goal_pin_proof: the same spend for the cancel
--    and complete flows, called inside their own transaction.
--
-- The proof binding is derived here, never taken from the caller (theme D):
-- customer and merchant come from the scope the reservation itself validates,
-- the amount from the request, and the Idempotency-Key digest is
-- SHA-256('<goalId>:<operationId>') for funding (so a proof is for one goal)
-- or SHA-256('<goalId>:<action>') for cancel and complete. Cancel and complete move the whole balance read from
-- PiggyVest at that moment, so their proofs bind the fixed amount 1 kobo
-- (a marker, not a money amount); the goal and action are bound by the key.
--
-- Failed-attempt lockout is the existing verify_wallet_pin lockout (5 wrong
-- PINs lock 30 minutes, doubling, capped at 24 hours).
--
-- Scope of this change: only funding is wired. The cancel and complete
-- purposes and consume_goal_pin_proof are groundwork; the goal cancel and
-- complete flows do not exist in the database yet (manage_savings only moves
-- a funding transfer reservation, it does not cancel or complete a goal), so
-- wiring them is a follow-up that calls consume_goal_pin_proof in the same
-- transaction as the state change.
--
-- The original reserve_savings(jsonb,jsonb) is no longer executable by the
-- savings executor login; only reserve_savings_with_pin (a definer function
-- owned by the migration owner) can reach it, so no reservation can be
-- created without spending a proof.

BEGIN;

INSERT INTO wallet_pin_private.proof_purposes (purpose)
VALUES ('goal_fund'), ('goal_cancel'), ('goal_complete')
ON CONFLICT (purpose) DO NOTHING;

CREATE FUNCTION piggyvest_primary.reserve_savings_with_pin(
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
  v_customer_id uuid;
  v_merchant_id uuid;
  v_goal_id uuid;
  v_operation text;
  v_amount bigint;
  v_result jsonb;
  v_outcome text;
BEGIN
  IF scope IS NULL OR request IS NULL
    OR pg_catalog.jsonb_typeof(scope) <> 'object'
    OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR NOT (scope ? 'customerId' AND scope ? 'merchantId')
    OR NOT (request ? 'goalId' AND request ? 'operationId' AND request ? 'amountKobo') THEN
    RAISE EXCEPTION 'invalid savings request' USING ERRCODE = '22023';
  END IF;
  v_customer_id := (scope ->> 'customerId')::uuid;
  v_merchant_id := (scope ->> 'merchantId')::uuid;
  v_goal_id := (request ->> 'goalId')::uuid;
  v_operation := ((request ->> 'operationId')::uuid)::text;
  v_amount := (request ->> 'amountKobo')::bigint;
  IF v_customer_id IS NULL OR v_merchant_id IS NULL OR v_goal_id IS NULL
    OR v_amount IS NULL OR v_amount NOT BETWEEN 1 AND 9999999999 THEN
    RAISE EXCEPTION 'invalid savings request' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_result := piggyvest_primary.reserve_savings(scope, request);
    IF COALESCE(v_result ->> 'status', '') <> 'claimed' THEN
      RETURN v_result;
    END IF;
    -- The proof is judged after the reservation holds its locks, and the
    -- consume function reads the clock itself after locking the proof row.
    v_outcome := wallet_pin_private.consume_wallet_pin_proof(
      v_customer_id, v_merchant_id, 'goal_fund', v_amount,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_goal_id::text || ':' || v_operation, 'UTF8')), 'hex'),
      pin_proof);
    IF v_outcome IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION 'pin_refused:%', COALESCE(v_outcome, 'invalid') USING ERRCODE = 'PVP01';
    END IF;
    RETURN v_result;
  EXCEPTION WHEN SQLSTATE 'PVP01' THEN
    -- Leaving the block rolled the reservation back.
    RETURN pg_catalog.jsonb_build_object(
      'status', 'pin_refused',
      'reason', pg_catalog.replace(SQLERRM, 'pin_refused:', ''));
  END;
END;
$$;

CREATE FUNCTION piggyvest_primary.consume_goal_pin_proof(
  scope jsonb,
  goal_id uuid,
  action text,
  pin_proof text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_purpose text;
BEGIN
  IF scope IS NULL OR goal_id IS NULL
    OR pg_catalog.jsonb_typeof(scope) <> 'object'
    OR NOT (scope ? 'customerId' AND scope ? 'merchantId')
    OR action IS NULL OR action NOT IN ('cancel', 'complete') THEN
    RAISE EXCEPTION 'invalid goal pin request' USING ERRCODE = '22023';
  END IF;
  -- Ownership of the scope (and the SESSION_USER authority) is checked here,
  -- at the transition, not only when the request was built.
  PERFORM piggyvest_primary.assert_savings_scope(scope);
  -- The goal itself must be an active goal of this customer and merchant. It
  -- is share-locked until the caller's transaction ends, so it cannot change
  -- hands or state between this check and the caller's state change. A proof
  -- is never spent for a foreign, missing or inactive goal.
  PERFORM 1
    FROM public.customer_savings_goals AS goal
   WHERE goal.id = consume_goal_pin_proof.goal_id
     AND goal.customer_id = (scope ->> 'customerId')::uuid
     AND goal.merchant_id = (scope ->> 'merchantId')::uuid
     AND goal.status = 'active'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'savings goal unavailable' USING ERRCODE = '42501';
  END IF;
  v_purpose := 'goal_' || action;
  RETURN wallet_pin_private.consume_wallet_pin_proof(
    (scope ->> 'customerId')::uuid, (scope ->> 'merchantId')::uuid,
    v_purpose, 1,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(goal_id::text || ':' || action, 'UTF8')), 'hex'),
    pin_proof);
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.reserve_savings_with_pin(jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.consume_goal_pin_proof(jsonb, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
-- The executor login reaches reserve_savings only through the wrapper above.
REVOKE EXECUTE ON FUNCTION piggyvest_primary.reserve_savings(jsonb, jsonb)
  FROM piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.reserve_savings_with_pin(jsonb, jsonb, text)
  TO piggyvest_primary_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary.consume_goal_pin_proof(jsonb, uuid, text, text)
  TO piggyvest_primary_authorizer;

COMMIT;
