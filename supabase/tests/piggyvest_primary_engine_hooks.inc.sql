-- Part of piggyvest_primary_engine_schema.sql (\ir): the kind-level
-- dispatchers route to their per-purpose sub-hooks. Inside this transaction
-- every sub-hook is replaced by a sentinel that returns its own name, so a
-- misroute to any other hook (even another no-op stub) is caught; the
-- installed definitions are put back at the end.

CREATE TEMP TABLE engine_saved_hooks ON COMMIT DROP AS
  SELECT p.proname::text AS hook, pg_catalog.pg_get_functiondef(p.oid) AS definition
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'piggyvest_primary' AND p.proname IN (
    'on_collect_confirmed_vtu', 'on_collect_confirmed_imei', 'on_collect_confirmed_checkout',
    'on_collect_failed_vtu', 'on_collect_failed_imei', 'on_collect_failed_checkout',
    'on_refund_confirmed', 'on_settled_disbursement_obligation',
    'on_settled_goal_forfeit_cancel_interest', 'on_settled_goal_forfeit_post_exit_interest',
    'on_failed_goal_forfeit_cancel_interest', 'on_failed_goal_forfeit_post_exit_interest');
SELECT pg_temp.check((SELECT count(*) FROM engine_saved_hooks) = 12, 'every per-purpose sub-hook must exist');

SELECT format('CREATE OR REPLACE FUNCTION piggyvest_primary.%I(p_transfer_id uuid, p_attempt_id uuid)
  RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $sentinel$ SELECT %L::text $sentinel$',
  hook, hook) FROM engine_saved_hooks \gexec

DO $$
DECLARE
  v_route record;
  v_result text;
BEGIN
  FOR v_route IN SELECT * FROM (VALUES
      ('on_settled_collect', 'm-collect-vtu', 'on_collect_confirmed_vtu'),
      ('on_settled_collect', 'm-collect-imei', 'on_collect_confirmed_imei'),
      ('on_settled_collect', 'm-collect-checkout', 'on_collect_confirmed_checkout'),
      ('on_failed_collect', 'm-collect-vtu', 'on_collect_failed_vtu'),
      ('on_failed_collect', 'm-collect-imei', 'on_collect_failed_imei'),
      ('on_failed_collect', 'm-collect-checkout', 'on_collect_failed_checkout'),
      ('on_settled_disbursement', 'm-refund', 'on_refund_confirmed'),
      ('on_settled_disbursement', 'm-obligation', 'on_settled_disbursement_obligation'),
      ('on_settled_goal_forfeit', 'm-forfeit-cancel', 'on_settled_goal_forfeit_cancel_interest'),
      ('on_settled_goal_forfeit', 'm-forfeit-post-exit', 'on_settled_goal_forfeit_post_exit_interest'),
      ('on_failed_goal_forfeit', 'm-forfeit-cancel', 'on_failed_goal_forfeit_cancel_interest'),
      ('on_failed_goal_forfeit', 'm-forfeit-post-exit', 'on_failed_goal_forfeit_post_exit_interest')
    ) AS route(dispatcher, source_ref, expected) LOOP
    EXECUTE format('SELECT piggyvest_primary.%I($1, NULL)', v_route.dispatcher) INTO v_result
      USING (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = v_route.source_ref);
    PERFORM pg_temp.check(v_result = v_route.expected,
      format('%s must route %s to %s, got %s', v_route.dispatcher, v_route.source_ref, v_route.expected, v_result));
  END LOOP;
  -- A dispatcher refuses a transfer of another kind.
  FOR v_route IN SELECT * FROM (VALUES ('on_settled_collect', 'm-legacy'), ('on_failed_collect', 'm-treasury'),
      ('on_settled_disbursement', 'm-collect-vtu'), ('on_settled_goal_forfeit', 'm-goal-refund'),
      ('on_failed_goal_forfeit', 'm-goal-sweep')) AS route(dispatcher, source_ref) LOOP
    PERFORM pg_temp.check(pg_temp.sqlstate_of(format('SELECT piggyvest_primary.%I(%L, NULL)', v_route.dispatcher,
      (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = v_route.source_ref))) = '22023',
      format('%s must refuse %s', v_route.dispatcher, v_route.source_ref));
  END LOOP;
END $$;

SELECT definition FROM engine_saved_hooks \gexec
SELECT pg_temp.check(piggyvest_primary.on_settled_collect(
  (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-checkout'), NULL) = 'noop',
  'the installed sub-hooks must be back in place');
