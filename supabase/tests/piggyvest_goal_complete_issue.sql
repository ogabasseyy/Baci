-- REGRESSION TEST (behaviour): eligibility, server-issued operation id, PIN
-- binding and reservation for goal complete
-- (migration 20261103181737_piggyvest_goal_complete_purchase_request).
-- Fixture and helpers live in the included part; registered in the replay
-- registry folder 20261103181737_piggyvest_goal_complete_purchase_request.
\set ON_ERROR_STOP on
\ir piggyvest_goal_complete_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3870000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3870000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3870000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gx_scope();
  v_issue jsonb;
  v_op text;
  v_result jsonb;
BEGIN
  -- 1. Eligibility: neither the target nor the maturity date reached.
  PERFORM pg_temp.gx_set_maturity(30);
  v_result := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'not_eligible', 'early complete issued: ' || v_result::text);
  PERFORM pg_temp.gx_assert(NOT piggyvest_primary.check_goal_complete_issued(v_scope, c_goal::uuid, c_invented::uuid),
    'an invented id passed the pre-check');
  PERFORM pg_temp.gx_assert(NOT EXISTS (SELECT 1 FROM piggyvest_primary.goal_complete_operations),
    'an ineligible issue wrote an operation');
  -- Target reached (current amount covers it) is enough without maturity.
  PERFORM pg_temp.gx_set_current(10000);
  v_issue := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_issue ->> 'status' = 'issued', 'target reached: ' || v_issue::text);
  -- The funded-goal trigger derives "completed" from funding, so a completed
  -- goal exists only while funding covers the target; it is eligible too.
  PERFORM pg_temp.gx_assert(pg_temp.gx_goal('status') = 'completed', 'the funded goal is not completed');
  v_issue := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_issue ->> 'status' = 'issued', 'completed status: ' || v_issue::text);
  PERFORM pg_temp.gx_set_current(2500);
  UPDATE public.customer_savings_goals SET status = 'active' WHERE id = c_goal::uuid;
  -- Maturity reached (today, UTC) is eligible, and the same id is reused.
  PERFORM pg_temp.gx_set_maturity(0);
  v_op := pg_temp.gx_issue_op() ->> 'operationId';
  PERFORM pg_temp.gx_assert(pg_temp.gx_issue_op() ->> 'operationId' = v_op, 'a live issued id was not reused');
  PERFORM pg_temp.gx_assert(piggyvest_primary.check_goal_complete_issued(v_scope, c_goal::uuid, v_op::uuid),
    'the pre-check refused a live id');
  -- A cancelled goal can not be completed.
  UPDATE public.customer_savings_goals SET status = 'cancelled' WHERE id = c_goal::uuid;
  BEGIN
    PERFORM pg_temp.gx_issue_op();
    RAISE EXCEPTION 'a cancelled goal was issued';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  UPDATE public.customer_savings_goals SET status = 'active' WHERE id = c_goal::uuid;

  -- 2. No proof / garbage: refused; the issued id stays usable.
  v_result := pg_temp.gx_reserve(v_op, NULL);
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'pin_refused' AND v_result ->> 'reason' = 'missing',
    'missing proof: ' || v_result::text);
  v_result := pg_temp.gx_reserve(v_op, 'not-a-proof');
  PERFORM pg_temp.gx_assert(v_result ->> 'reason' = 'invalid', 'garbage proof: ' || v_result::text);
  PERFORM pg_temp.gx_assert(pg_temp.gx_state(v_op) = 'issued', 'a refusal changed the state');

  -- 3. An id this database never issued is never spent against.
  PERFORM pg_temp.gx_issue('invented', 'goal_complete', 1, pg_temp.gx_key(c_invented));
  v_result := pg_temp.gx_reserve(c_invented, pg_temp.gx_token('invented'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'conflict', 'invented id: ' || v_result::text);
  PERFORM pg_temp.gx_assert(NOT pg_temp.gx_spent('invented'), 'a proof was spent for an invented id');

  -- 4. Wrong bindings are mismatches, rolled back and left unspent: the old
  -- unbound goal:complete key, another operation, the cancel purpose, an amount.
  PERFORM pg_temp.gx_issue('unbound', 'goal_complete', 1, c_goal || ':complete');
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('unbound')) ->> 'reason' = 'mismatch',
    'unbound key accepted');
  PERFORM pg_temp.gx_issue('other-op', 'goal_complete', 1, pg_temp.gx_key(c_other));
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('other-op')) ->> 'reason' = 'mismatch',
    'another operation accepted');
  PERFORM pg_temp.gx_issue('wrong-purpose', 'goal_cancel', 1, c_goal || ':cancel:' || v_op);
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('wrong-purpose')) ->> 'reason' = 'mismatch',
    'a cancel proof was accepted for complete');
  PERFORM pg_temp.gx_issue('wrong-amount', 'goal_complete', 5000, pg_temp.gx_key(v_op));
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('wrong-amount')) ->> 'reason' = 'mismatch',
    'a wrong amount was accepted');
  PERFORM pg_temp.gx_assert(NOT pg_temp.gx_spent('unbound') AND NOT pg_temp.gx_spent('wrong-purpose')
    AND pg_temp.gx_state(v_op) = 'issued', 'a mismatched proof was spent');
  DELETE FROM wallet_pin_private.proofs WHERE consumed_at IS NULL;

  -- 5. An expired proof is refused.
  PERFORM pg_temp.gx_issue('expired', 'goal_complete', 1, pg_temp.gx_key(v_op), 121);
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('expired')) ->> 'reason' = 'expired',
    'expired proof accepted');
  DELETE FROM wallet_pin_private.proofs WHERE consumed_at IS NULL;

  -- 6. A malformed request is invalid, never defaulted.
  BEGIN
    PERFORM piggyvest_primary.reserve_goal_complete_with_pin(v_scope,
      pg_catalog.jsonb_build_object('operationId', v_op), pg_temp.gx_token('unbound'));
    RAISE EXCEPTION 'request without a goal id was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- 7. Eligibility is re-judged at the reservation, before the proof is
  -- spent: an id issued while eligible does not outlive eligibility.
  PERFORM pg_temp.gx_set_maturity(30);
  PERFORM pg_temp.gx_issue('late-ineligible', 'goal_complete', 1, pg_temp.gx_key(v_op));
  v_result := pg_temp.gx_reserve(v_op, pg_temp.gx_token('late-ineligible'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'not_eligible', 'ineligible at reserve: ' || v_result::text);
  PERFORM pg_temp.gx_assert(NOT pg_temp.gx_spent('late-ineligible') AND pg_temp.gx_state(v_op) = 'issued',
    'a proof was spent for an ineligible goal');
  PERFORM pg_temp.gx_set_maturity(0);

  -- 8. An expired id is dead whatever the proof says.
  UPDATE piggyvest_primary.goal_complete_operations SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_op::uuid;
  v_result := pg_temp.gx_reserve(v_op, pg_temp.gx_token('late-ineligible'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'expired' AND pg_temp.gx_state(v_op) = 'released',
    'expired id: ' || v_result::text);
  DELETE FROM wallet_pin_private.proofs WHERE consumed_at IS NULL;

  -- 9. The exact proof reserves the attempt and is spent with it.
  v_op := pg_temp.gx_issue_op() ->> 'operationId';
  PERFORM pg_temp.gx_issue('exact', 'goal_complete', 1, pg_temp.gx_key(v_op));
  v_result := pg_temp.gx_reserve(v_op, pg_temp.gx_token('exact'));
  PERFORM pg_temp.gx_assert(v_result ->> 'status' = 'claimed', 'exact proof: ' || v_result::text);
  PERFORM pg_temp.gx_assert(
    v_result #>> '{reservation,sourceWalletId}' = 'synthetic-goalcomplete-goal-wallet'
    AND v_result #>> '{reservation,destinationWalletId}' = 'synthetic-goalcomplete-main'
    AND v_result #>> '{reservation,reference}' = 'pvb-complete-' || c_goal
    AND v_result #>> '{reservation,providerCustomerId}' = 'synthetic-goalcomplete-customer',
    'reservation shape: ' || v_result::text);
  PERFORM pg_temp.gx_assert(pg_temp.gx_spent('exact') AND pg_temp.gx_state(v_op) = 'reserved',
    'the proof was not spent with the reservation');
  -- 10. A replay needs no new proof and spends none; a live attempt blocks issue.
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, NULL) ->> 'status' = 'pending', 'replay');
  PERFORM pg_temp.gx_assert(pg_temp.gx_reserve(v_op, pg_temp.gx_token('exact')) ->> 'status' = 'pending',
    'replay with a spent proof');
  v_issue := pg_temp.gx_issue_op();
  PERFORM pg_temp.gx_assert(v_issue ->> 'status' = 'pending' AND v_issue ->> 'operationId' = v_op,
    'issue during a live attempt: ' || v_issue::text);
  PERFORM pg_temp.gx_assert(piggyvest_primary.read_goal_complete_status(v_scope, v_op::uuid) = 'reserved',
    'status of a reserved attempt');
  PERFORM pg_temp.gx_assert(piggyvest_primary.read_goal_complete_status(v_scope, c_invented::uuid) IS NULL,
    'status of an unknown id');
END
$behaviour$;

ROLLBACK;
