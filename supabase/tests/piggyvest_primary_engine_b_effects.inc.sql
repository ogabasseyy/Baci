-- Part of piggyvest_primary_engine_schema.sql (\ir): the B writer.
-- B is the spendable customer_wallets balance. request_b_effect is the only
-- entry; it applies inline only when session_may_write_b() is true, and the
-- worker applies everything else. Runs inside the entry file's transaction.

-- The installed session_may_write_b() is kept: the API-session checks below
-- run against it, not against a copy of the stub.
SELECT pg_catalog.pg_get_functiondef('piggyvest_primary.session_may_write_b()'::regprocedure)
  AS shipped_session_may_write_b \gset

-- The suite session is not an engine session, so a hold debit (which must
-- apply inline) is refused and nothing is written.
DO $$
DECLARE
  v_collect uuid := pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'b-stub-hold', 'held', 10000);
BEGIN
  PERFORM pg_temp.check(NOT piggyvest_primary.session_may_write_b(), 'the suite session must not write B');
  PERFORM pg_temp.check(pg_temp.error_of(format(
    'SELECT piggyvest_primary.request_b_effect(%L, ''hold_debit'', 10000)', v_collect))
    LIKE '%b_effect_requires_engine_login%', 'a hold debit outside an engine session must raise');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.transfer_b_effects WHERE transfer_id = v_collect)
    AND pg_temp.balance(pg_temp.id(3)) = 1000.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = 0,
    'a refused hold debit must leave no effect row and no wallet write');
END $$;

-- Simulate an engine session inside this transaction only.
CREATE OR REPLACE FUNCTION piggyvest_primary.session_may_write_b() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT true $$;

DO $$
DECLARE
  v_collect uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'b-stub-hold');
  v_refund_one uuid;
  v_refund_two uuid;
  v_payout uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-support-payout');
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_collect, 'hold_debit', 10000) = 'applied',
    'an engine session applies a hold debit inline');
  PERFORM pg_temp.check(pg_temp.balance(pg_temp.id(3)) = 900.00, 'the hold debit must take NGN 100 off B');
  PERFORM pg_temp.check((SELECT type || ':' || amount || ':' || balance_after || ':' || source_type
    FROM public.customer_wallet_transactions WHERE customer_id = pg_temp.id(3))
    = 'debit:100.00:900.00:piggyvest_primary_hold_debit', 'the hold debit must write one ledger row');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_collect, 'hold_debit', 10000) = 'duplicate',
    'the same effect twice must answer duplicate');
  PERFORM pg_temp.check((SELECT count(*) FROM piggyvest_primary.transfer_b_effects WHERE transfer_id = v_collect) = 1
    AND pg_temp.ledger_rows(pg_temp.id(3)) = 1, 'a duplicate must not add a row or a write');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_collect, 'hold_debit', 9000) = 'conflict',
    'the same effect with another amount must answer conflict');

  -- Wrong effect for the kind, wrong amount, wrong state: programming errors raise.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'SELECT piggyvest_primary.request_b_effect(%L, ''confirm_credit'', 100)',
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-legacy'))) = '22023',
    'legacy_migration must never credit B');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'SELECT piggyvest_primary.request_b_effect(%L, ''hold_debit'', 9999)',
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-checkout'))) = '22023',
    'a hold debit must be the full leg amount');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'SELECT piggyvest_primary.request_b_effect(%L, ''release_credit'', 100)', v_collect)) = '55000',
    'a release needs a cancelled leg');
  PERFORM pg_temp.check(pg_temp.error_of(format(
    'SELECT piggyvest_primary.request_b_effect(%L, ''hold_debit'', 100000000)',
    pg_temp.wt('collect', 'imei', 'deliver_before_collect', 'b-too-big', 'held', 100000000)))
    LIKE '%insufficient_wallet_balance%', 'an inline debit beyond B must raise');

  -- A payout freeze is never applied inline, even in an engine session.
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_payout, 'payout_freeze_debit', 10000) = 'requested',
    'a payout freeze must wait for the worker');

  -- R4: a collect family's credits never exceed its hold debit.
  UPDATE piggyvest_primary.wallet_transfers SET state = 'ready' WHERE id = v_collect;
  v_refund_one := pg_temp.wt('disbursement', 'refund', 'credit_main', 'b-refund-one', 'ready', 6000,
    jsonb_build_object('refundOf', v_collect));
  v_refund_two := pg_temp.wt('disbursement', 'refund', 'credit_main', 'b-refund-two', 'ready', 6000,
    jsonb_build_object('refundOf', v_collect));
  UPDATE piggyvest_primary.wallet_transfers SET state = 'netted' WHERE id IN (v_refund_one, v_refund_two);
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_refund_one, 'refund_netted', 6000) = 'applied',
    'a refund inside the hold debit applies');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_refund_two, 'refund_netted', 6000) = 'review',
    'credits above the hold debit must go to review');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_refund_two, 'refund_netted', 6000) = 'review',
    'repeating a request that is in review must still answer review');
  PERFORM pg_temp.check(pg_temp.balance(pg_temp.id(3)) = 960.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = 2,
    'a refused family credit must not write B');
  PERFORM pg_temp.check((SELECT state || ':' || family_collect FROM piggyvest_primary.transfer_b_effects
    WHERE transfer_id = v_refund_two) = 'review:' || v_collect, 'the over-cap credit is recorded for review');
  PERFORM pg_temp.check((SELECT effect_state FROM piggyvest_primary.wallet_transfers WHERE id = v_refund_two) = 'review',
    'the over-cap transfer must be marked for review');
  -- A credit with no hold debit in its family is refused the same way.
  UPDATE piggyvest_primary.wallet_transfers SET state = 'cancelled'
    WHERE source_ref = 'm-collect-checkout';
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(
    (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-collect-checkout'), 'release_credit', 10000)
    = 'review', 'a release without a hold debit must go to review');
END $$;

-- Back to the installed definition: every API-facing session only requests.
SELECT :'shipped_session_may_write_b' \gexec

-- A test-only SECURITY DEFINER wrapper stands in for a future API-facing RPC.
CREATE FUNCTION pg_temp.api_request(p_transfer uuid, p_effect text, p_amount bigint) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT piggyvest_primary.request_b_effect(p_transfer, p_effect, p_amount)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.api_request(uuid, text, bigint) TO authenticated, service_role;

SELECT pg_temp.confirm(id) FROM piggyvest_primary.wallet_transfers WHERE source_ref IN ('m-obligation', 'm-goal-refund');
SELECT id AS obligation_id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-obligation' \gset
SELECT id AS goal_refund_id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-refund' \gset

SET LOCAL ROLE authenticated;
SELECT pg_temp.api_request(:'obligation_id', 'confirm_credit', 10000) AS authenticated_result \gset
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.api_request(:'goal_refund_id', 'confirm_credit', 10000) AS service_role_result \gset
RESET ROLE;

-- When the suite login may switch session authorization (a superuser), also
-- run the request as PostgREST does: the authenticator login with SET ROLE.
-- The savepoint discards the extra request so the counts below hold either way.
SELECT rolsuper AS engine_suite_superuser FROM pg_catalog.pg_roles WHERE rolname = session_user \gset
\if :engine_suite_superuser
SAVEPOINT engine_authenticator;
SELECT pg_temp.confirm(id) FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-leftover';
SELECT id AS goal_leftover_id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-leftover' \gset
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT pg_temp.api_request(:'goal_leftover_id', 'confirm_credit', 10000) AS authenticator_result \gset
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT pg_temp.check(:'authenticator_result' = 'requested'
  AND (SELECT requested_by_login FROM piggyvest_primary.transfer_b_effects
    WHERE transfer_id = :'goal_leftover_id') = 'authenticator'
  AND pg_temp.balance(pg_temp.id(3)) = 960.00,
  'an authenticator session with SET ROLE authenticated must only request');
ROLLBACK TO SAVEPOINT engine_authenticator;
\endif

SELECT pg_temp.check(:'authenticated_result' = 'requested', 'an authenticated session must only request');
SELECT pg_temp.check(:'service_role_result' = 'requested', 'a service_role session must only request');
SELECT pg_temp.check(pg_temp.balance(pg_temp.id(3)) = 960.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = 2,
  'requests from API sessions must leave customer_wallets untouched');

-- A request that cannot be applied (here a credit that would overflow the
-- wallet balance column) must not block the others: it goes to review.
INSERT INTO public.customers(id, merchant_id) VALUES (pg_temp.id(60), pg_temp.id(2));
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(61), pg_temp.id(5), pg_temp.id(2), pg_temp.id(60), pg_temp.id(1),
    repeat('c', 64), 'verified', 'pv-engine-customer-60', 'pv-engine-main-60');
INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance)
  VALUES (pg_temp.id(60), pg_temp.id(2), 9999999999.00);
SELECT pg_temp.wt('disbursement', 'obligation', 'credit_main', 'b-poison', 'ready', 1000,
  jsonb_build_object('customer', pg_temp.id(60))) AS poison_transfer \gset
SELECT pg_temp.confirm(:'poison_transfer');
SELECT pg_temp.check(piggyvest_primary.request_b_effect(:'poison_transfer', 'confirm_credit', 1000) = 'requested',
  'the overflowing credit is requested');

-- Only an enabled worker login may apply, and it applies each request once.
SELECT pg_temp.check(pg_temp.sqlstate_of('SELECT piggyvest_primary.apply_requested_b_effects(10)') = '42501',
  'applying needs a registered worker login');
INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
  VALUES (pg_temp.id(5), 'worker', session_user, true);
SET LOCAL ROLE piggyvest_primary_transfer_worker;
SELECT piggyvest_primary.apply_requested_b_effects(10) AS applied_first \gset
SELECT piggyvest_primary.apply_requested_b_effects(10) AS applied_second \gset
RESET ROLE;

SELECT pg_temp.check(:applied_first = 3, 'the worker must apply the three requested effects');
SELECT pg_temp.check(:applied_second = 0, 'a second pass must apply nothing');
SELECT pg_temp.check((SELECT effect.state = 'review' AND effect.review_reason LIKE 'apply\_failed:%'
    AND transfer.effect_state = 'review'
  FROM piggyvest_primary.transfer_b_effects effect
  JOIN piggyvest_primary.wallet_transfers transfer ON transfer.id = effect.transfer_id
  WHERE effect.transfer_id = :'poison_transfer') AND pg_temp.balance(pg_temp.id(60)) = 9999999999.00,
  'a failing request goes to review without writing B');
-- 960 + 100 (obligation) + 100 (goal refund) - 100 (payout freeze) = 1060.
SELECT pg_temp.check(pg_temp.balance(pg_temp.id(3)) = 1060.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = 5,
  'each requested effect must be written exactly once');
SELECT pg_temp.check((SELECT bool_and(applied_by_login = session_user AND applied_at IS NOT NULL)
  FROM piggyvest_primary.transfer_b_effects WHERE state = 'applied'), 'applied rows record the applying login');
SELECT pg_temp.check(pg_temp.sqlstate_of(
  'UPDATE piggyvest_primary.transfer_b_effects SET amount_kobo = 1 WHERE state = ''applied''') = '42501',
  'an applied effect must be immutable');
SELECT pg_temp.check(pg_temp.sqlstate_of(
  'UPDATE piggyvest_primary.transfer_b_effects SET state = ''requested'' WHERE state = ''applied''') = '42501',
  'an applied effect must never be re-requested');
SELECT pg_temp.check(pg_temp.sqlstate_of('DELETE FROM piggyvest_primary.transfer_b_effects') = '42501',
  'effects are never deleted');
DELETE FROM piggyvest_primary.transfer_authorities WHERE executor_login = session_user;
