-- REGRESSION TEST (behaviour): PIN proof binding, reservation and replay
-- (migration 20261103085004_piggyvest_goal_cancel_refund). Fixture and
-- helpers live in the included part; registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3860000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3860000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gc_scope();
  v_issue jsonb;
  v_issue2 jsonb;
  v_op text;
  v_op2 text;
  v_result jsonb;
  v_text text;
BEGIN
  v_op := pg_temp.gc_issue_op() ->> 'operationId';

  -- 2. No proof / garbage: refused; the issued id stays usable.
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'missing proof: ' || v_result::text);
  v_result := pg_temp.gc_reserve(v_op, 'not-a-proof');
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'invalid', 'garbage proof: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'issued', 'a refusal changed the state');

  -- 3. An operation id this database never issued is never spent against,
  -- even with a proof bound to it.
  PERFORM pg_temp.gc_issue('invented', 'goal_cancel', 1, pg_temp.gc_key(c_invented));
  v_result := pg_temp.gc_reserve(c_invented, pg_temp.gc_token('invented'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'conflict', 'invented id: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('invented'), 'a proof was spent for an invented id');

  -- 4. Wrong bindings are mismatches, rolled back and left unspent: the
  -- unbound goal:cancel key, another operation, another purpose, another amount.
  PERFORM pg_temp.gc_issue('unbound', 'goal_cancel', 1, c_goal || ':cancel');
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('unbound'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'unbound key: ' || v_result::text);
  PERFORM pg_temp.gc_issue('other-op', 'goal_cancel', 1, pg_temp.gc_key(c_other));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('other-op'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'other operation: ' || v_result::text);
  PERFORM pg_temp.gc_issue('wrong-purpose', 'goal_fund', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('wrong-purpose'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'wrong purpose: ' || v_result::text);
  PERFORM pg_temp.gc_issue('wrong-amount', 'goal_cancel', 5000, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('wrong-amount'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'mismatch', 'wrong amount: ' || v_result::text);
  PERFORM pg_temp.gc_assert(NOT pg_temp.gc_spent('unbound') AND NOT pg_temp.gc_spent('wrong-amount'),
    'a mismatched proof was spent');
  PERFORM pg_temp.gc_assert(pg_temp.gc_state(v_op) = 'issued', 'a mismatch changed the state');

  -- 5. An expired proof is refused (one live proof per binding, so the unspent
  -- wrong-amount proof is removed first).
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 = pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('wrong-amount'), 'hex'));
  PERFORM pg_temp.gc_issue('expired', 'goal_cancel', 1, pg_temp.gc_key(v_op), 121);
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('expired'));
  PERFORM pg_temp.gc_assert(v_result ->> 'reason' = 'expired', 'expired proof: ' || v_result::text);

  -- 6. A malformed request is invalid, never defaulted.
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_cancel_with_pin(v_scope,
      pg_catalog.jsonb_build_object('operationId', v_op), pg_temp.gc_token('unbound'));
    RAISE EXCEPTION 'request without a goal id was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_cancel_with_pin(v_scope, NULL, pg_temp.gc_token('unbound'));
    RAISE EXCEPTION 'null request was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- 7. The exact proof reserves the attempt and is spent with it.
  DELETE FROM wallet_pin_private.proofs
   WHERE token_sha256 IN (pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('unbound'), 'hex')),
                          pg_catalog.sha256(pg_catalog.decode(pg_temp.gc_token('expired'), 'hex')));
  PERFORM pg_temp.gc_issue('exact', 'goal_cancel', 1, pg_temp.gc_key(v_op));
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'claimed', 'exact proof: ' || v_result::text);
  PERFORM pg_temp.gc_assert(
    v_result #>> '{reservation,sourceWalletId}' = 'synthetic-goalcancel-goal-wallet'
    AND v_result #>> '{reservation,destinationWalletId}' = 'synthetic-goalcancel-main'
    AND v_result #>> '{reservation,reference}' = 'pvb-cancel-' || c_goal
    AND v_result #>> '{reservation,providerCustomerId}' = 'synthetic-goalcancel-customer',
    'reservation shape: ' || v_result::text);
  PERFORM pg_temp.gc_assert(pg_temp.gc_spent('exact') AND pg_temp.gc_state(v_op) = 'reserved',
    'the proof was not spent with the reservation');

  -- 8. A replay needs no new proof and spends none; a spent proof cannot be reused.
  v_result := pg_temp.gc_reserve(v_op, NULL);
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pending', 'replay: ' || v_result::text);
  v_result := pg_temp.gc_reserve(v_op, pg_temp.gc_token('exact'));
  PERFORM pg_temp.gc_assert(v_result ->> 'status' = 'pending', 'replay with spent proof: ' || v_result::text);
  v_issue2 := pg_temp.gc_issue_op();
  PERFORM pg_temp.gc_assert(v_issue2 ->> 'status' = 'pending' AND v_issue2 ->> 'operationId' = v_op,
    'issue during a live attempt: ' || v_issue2::text);

END
$behaviour$;

ROLLBACK;
