-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 6 of 6: settlement hooks.
--
-- Settling or failing an attempt calls on_settled_<kind> or on_failed_<kind>
-- with (transfer id, attempt id). Every hook is declared here so later
-- changes only fill in bodies, never add tables or entry points:
--   * dispatchers (owned by the engine) route by purpose: a collect to
--     on_collect_confirmed_<purpose> or on_collect_failed_<purpose> (vtu,
--     imei, checkout), goal_forfeit to its cancel_interest and
--     post_exit_interest sub-hooks, and a settled disbursement to
--     on_refund_confirmed (refunds) or on_settled_disbursement_obligation.
--     An owner implements the sub-hook it owns, never the dispatcher;
--   * every other hook is a no-op stub that returns 'noop' until its owner
--     replaces it. supabase/tests/piggyvest_hook_ownership.inc.sql lists each
--     owner, and the CI ownership check refuses a redefinition by anyone
--     else, a second definition of settle_attempt or fail_attempt, and any
--     hook body that touches the wallet tables directly (B changes only
--     through request_b_effect).
-- enqueue_misrouted_interest_sweep is the only writer of interest_sweep
-- transfers; it ships as a stub that refuses until its owner replaces it.
-- No hook is executable by any role: engine functions call them.
BEGIN;
CREATE FUNCTION piggyvest_primary.on_collect_confirmed_vtu(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_collect_failed_vtu(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_collect_confirmed_imei(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_collect_failed_imei(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_collect_confirmed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_collect_failed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_refund_confirmed(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_disbursement_obligation(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_disbursement(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_legacy_migration(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_legacy_migration(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_legacy_goal_migration(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_legacy_goal_migration(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_purchase(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_purchase(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_leftover(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_leftover(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_refund(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_refund(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_forfeit_cancel_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_forfeit_cancel_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_forfeit_post_exit_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_forfeit_post_exit_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_support_payout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_support_payout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_treasury_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_treasury_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_settled_interest_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE FUNCTION piggyvest_primary.on_failed_interest_sweep(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;

CREATE FUNCTION piggyvest_primary.on_settled_collect(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CASE (SELECT transfer.purpose FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id AND transfer.kind = 'collect')
    WHEN 'vtu' THEN RETURN piggyvest_primary.on_collect_confirmed_vtu(p_transfer_id, p_attempt_id);
    WHEN 'imei' THEN RETURN piggyvest_primary.on_collect_confirmed_imei(p_transfer_id, p_attempt_id);
    WHEN 'checkout' THEN RETURN piggyvest_primary.on_collect_confirmed_checkout(p_transfer_id, p_attempt_id);
    ELSE RAISE EXCEPTION 'not a collect transfer' USING ERRCODE = '22023';
  END CASE;
END $$;
CREATE FUNCTION piggyvest_primary.on_failed_collect(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CASE (SELECT transfer.purpose FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id AND transfer.kind = 'collect')
    WHEN 'vtu' THEN RETURN piggyvest_primary.on_collect_failed_vtu(p_transfer_id, p_attempt_id);
    WHEN 'imei' THEN RETURN piggyvest_primary.on_collect_failed_imei(p_transfer_id, p_attempt_id);
    WHEN 'checkout' THEN RETURN piggyvest_primary.on_collect_failed_checkout(p_transfer_id, p_attempt_id);
    ELSE RAISE EXCEPTION 'not a collect transfer' USING ERRCODE = '22023';
  END CASE;
END $$;
CREATE FUNCTION piggyvest_primary.on_settled_disbursement(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CASE (SELECT transfer.purpose FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id AND transfer.kind = 'disbursement')
    WHEN 'refund' THEN RETURN piggyvest_primary.on_refund_confirmed(p_transfer_id, p_attempt_id);
    WHEN 'obligation' THEN RETURN piggyvest_primary.on_settled_disbursement_obligation(p_transfer_id, p_attempt_id);
    ELSE RAISE EXCEPTION 'not a disbursement transfer' USING ERRCODE = '22023';
  END CASE;
END $$;
CREATE FUNCTION piggyvest_primary.on_settled_goal_forfeit(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CASE (SELECT transfer.purpose FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id AND transfer.kind = 'goal_forfeit')
    WHEN 'cancel_interest' THEN
      RETURN piggyvest_primary.on_settled_goal_forfeit_cancel_interest(p_transfer_id, p_attempt_id);
    WHEN 'post_exit_interest' THEN
      RETURN piggyvest_primary.on_settled_goal_forfeit_post_exit_interest(p_transfer_id, p_attempt_id);
    ELSE RAISE EXCEPTION 'not a goal forfeit transfer' USING ERRCODE = '22023';
  END CASE;
END $$;
CREATE FUNCTION piggyvest_primary.on_failed_goal_forfeit(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  CASE (SELECT transfer.purpose FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id AND transfer.kind = 'goal_forfeit')
    WHEN 'cancel_interest' THEN
      RETURN piggyvest_primary.on_failed_goal_forfeit_cancel_interest(p_transfer_id, p_attempt_id);
    WHEN 'post_exit_interest' THEN
      RETURN piggyvest_primary.on_failed_goal_forfeit_post_exit_interest(p_transfer_id, p_attempt_id);
    ELSE RAISE EXCEPTION 'not a goal forfeit transfer' USING ERRCODE = '22023';
  END CASE;
END $$;

-- Approval-only: the one writer of interest_sweep transfers (stub).
CREATE FUNCTION piggyvest_primary.enqueue_misrouted_interest_sweep(
  p_integration_id uuid, p_customer_id uuid, p_payout_transaction_id text, p_amount_kobo bigint,
  p_approval_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- engine-stub
  RAISE EXCEPTION 'misrouted interest sweep is not installed' USING ERRCODE = '0A000';
END $$;

-- Nothing above is executable by any role, including service_role.
REVOKE ALL ON FUNCTION
  piggyvest_primary.on_collect_confirmed_vtu(uuid, uuid),
  piggyvest_primary.on_collect_failed_vtu(uuid, uuid),
  piggyvest_primary.on_collect_confirmed_imei(uuid, uuid),
  piggyvest_primary.on_collect_failed_imei(uuid, uuid),
  piggyvest_primary.on_collect_confirmed_checkout(uuid, uuid),
  piggyvest_primary.on_collect_failed_checkout(uuid, uuid),
  piggyvest_primary.on_refund_confirmed(uuid, uuid),
  piggyvest_primary.on_settled_disbursement_obligation(uuid, uuid),
  piggyvest_primary.on_failed_disbursement(uuid, uuid),
  piggyvest_primary.on_settled_legacy_migration(uuid, uuid),
  piggyvest_primary.on_failed_legacy_migration(uuid, uuid),
  piggyvest_primary.on_settled_legacy_goal_migration(uuid, uuid),
  piggyvest_primary.on_failed_legacy_goal_migration(uuid, uuid),
  piggyvest_primary.on_settled_goal_purchase(uuid, uuid),
  piggyvest_primary.on_failed_goal_purchase(uuid, uuid),
  piggyvest_primary.on_settled_goal_leftover(uuid, uuid),
  piggyvest_primary.on_failed_goal_leftover(uuid, uuid),
  piggyvest_primary.on_settled_goal_refund(uuid, uuid),
  piggyvest_primary.on_failed_goal_refund(uuid, uuid),
  piggyvest_primary.on_settled_goal_forfeit_cancel_interest(uuid, uuid),
  piggyvest_primary.on_failed_goal_forfeit_cancel_interest(uuid, uuid),
  piggyvest_primary.on_settled_goal_forfeit_post_exit_interest(uuid, uuid),
  piggyvest_primary.on_failed_goal_forfeit_post_exit_interest(uuid, uuid),
  piggyvest_primary.on_settled_goal_sweep(uuid, uuid),
  piggyvest_primary.on_failed_goal_sweep(uuid, uuid),
  piggyvest_primary.on_settled_support_payout(uuid, uuid),
  piggyvest_primary.on_failed_support_payout(uuid, uuid),
  piggyvest_primary.on_settled_treasury_sweep(uuid, uuid),
  piggyvest_primary.on_failed_treasury_sweep(uuid, uuid),
  piggyvest_primary.on_settled_interest_sweep(uuid, uuid),
  piggyvest_primary.on_failed_interest_sweep(uuid, uuid),
  piggyvest_primary.on_settled_collect(uuid, uuid),
  piggyvest_primary.on_failed_collect(uuid, uuid),
  piggyvest_primary.on_settled_disbursement(uuid, uuid),
  piggyvest_primary.on_settled_goal_forfeit(uuid, uuid),
  piggyvest_primary.on_failed_goal_forfeit(uuid, uuid),
  piggyvest_primary.enqueue_misrouted_interest_sweep(uuid, uuid, text, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
