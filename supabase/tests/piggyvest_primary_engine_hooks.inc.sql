-- Part of piggyvest_primary_engine_schema.sql (\ir): the kind-level
-- dispatchers route to their per-purpose sub-hooks. Owner replacements are
-- simulated inside this transaction and restored to the declared stubs.

CREATE OR REPLACE FUNCTION piggyvest_primary.on_settled_collect_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'checkout-settled'::text $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_failed_collect_imei(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'imei-failed'::text $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_refund_confirmed(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'refund-confirmed'::text $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_settled_goal_forfeit_post_exit_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'post-exit-settled'::text $$;

DO $$
DECLARE
  v_ref text;
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.on_settled_collect(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-checkout'), NULL) = 'checkout-settled',
    'a checkout collect must settle through its checkout hook');
  PERFORM pg_temp.check(piggyvest_primary.on_settled_collect(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-vtu'), NULL) = 'noop',
    'an airtime collect must settle through the airtime hook');
  PERFORM pg_temp.check(piggyvest_primary.on_failed_collect(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-imei'), NULL) = 'imei-failed',
    'an IMEI collect must fail through the IMEI hook');
  PERFORM pg_temp.check(piggyvest_primary.on_settled_disbursement(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-refund'), NULL) = 'refund-confirmed',
    'a refund disbursement must call on_refund_confirmed');
  PERFORM pg_temp.check(piggyvest_primary.on_settled_disbursement(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-obligation'), NULL) = 'noop',
    'an obligation disbursement must call the obligation hook');
  PERFORM pg_temp.check(piggyvest_primary.on_settled_goal_forfeit(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-forfeit-post-exit'), NULL) = 'post-exit-settled',
    'post-exit interest must settle through its forfeit sub-hook');
  PERFORM pg_temp.check(piggyvest_primary.on_failed_goal_forfeit(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-forfeit-cancel'), NULL) = 'noop',
    'a cancel forfeit must fail through its forfeit sub-hook');
  -- A dispatcher refuses a transfer of another kind.
  FOREACH v_ref IN ARRAY ARRAY['m-legacy', 'm-treasury'] LOOP
    PERFORM pg_temp.check(pg_temp.sqlstate_of(format('SELECT piggyvest_primary.on_settled_collect(%L, NULL)',
      (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = v_ref))) = '22023',
      format('the collect dispatcher must refuse %s', v_ref));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.on_settled_collect_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_failed_collect_imei(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_refund_confirmed(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.on_settled_goal_forfeit_post_exit_interest(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 'noop'::text /* engine-stub */ $$;
