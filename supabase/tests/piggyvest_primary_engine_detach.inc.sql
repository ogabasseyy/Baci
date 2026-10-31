-- Part of piggyvest_primary_engine_schema.sql (\ir): account deletion.
-- Deleting a customer must never abort on settled engine rows (they detach
-- and keep their evidence), and must be refused while a transfer, a B
-- request or a spend hold is still open. Runs inside the entry file's
-- transaction, after the B-writer part.

-- Customer 3 still has transfers in flight: deletion is refused by the engine.
-- (The provider account closure is attested first so that only the engine
-- guard can be the reason.)
UPDATE piggyvest_primary.onboarding_intents SET provider_closed_at = TIMESTAMPTZ '2026-10-31 03:00:00+00'
  WHERE id = pg_temp.id(6);
SELECT pg_temp.check(pg_temp.error_of(format('DELETE FROM public.customers WHERE id = %L', pg_temp.id(3)))
  LIKE '%unsettled wallet transfer%', 'a customer with a transfer in flight must not be deleted');

-- Customer 50 has one settled credit: first still requested, then applied.
INSERT INTO public.customers(id, merchant_id) VALUES (pg_temp.id(50), pg_temp.id(2));
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(51), pg_temp.id(5), pg_temp.id(2), pg_temp.id(50), pg_temp.id(1),
    repeat('d', 64), 'verified', 'pv-engine-customer-50', 'pv-engine-main-50');
UPDATE piggyvest_primary.onboarding_intents SET provider_closed_at = TIMESTAMPTZ '2026-10-31 03:00:00+00'
  WHERE id = pg_temp.id(51);
SELECT pg_temp.wt('disbursement', 'obligation', 'credit_main', 'd-obligation', 'ready', 2000,
  jsonb_build_object('customer', pg_temp.id(50))) AS detach_transfer \gset
UPDATE piggyvest_primary.wallet_transfers SET state = 'confirmed' WHERE id = :'detach_transfer';
SELECT pg_temp.check(piggyvest_primary.request_b_effect(:'detach_transfer', 'confirm_credit', 2000) = 'requested',
  'the settled credit is requested for the worker');
SELECT pg_temp.check(pg_temp.error_of(format('DELETE FROM public.customers WHERE id = %L', pg_temp.id(50)))
  LIKE '%unsettled wallet transfer%', 'a customer with a requested B change must not be deleted');

INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
  VALUES (pg_temp.id(5), 'worker', session_user, true);
SET LOCAL ROLE piggyvest_primary_transfer_worker;
SELECT piggyvest_primary.apply_requested_b_effects(10) AS detach_applied \gset
RESET ROLE;
SELECT pg_temp.check(:detach_applied = 1 AND pg_temp.balance(pg_temp.id(50)) = 20.00,
  'the worker credits the new customer once');

-- An active spend hold blocks deletion; once released it detaches.
INSERT INTO piggyvest_primary.wallet_spend_holds(id, integration_id, customer_id, reason)
  VALUES (pg_temp.id(53), pg_temp.id(5), pg_temp.id(50), 'restriction');
SELECT pg_temp.check(pg_temp.error_of(format('DELETE FROM public.customers WHERE id = %L', pg_temp.id(50)))
  LIKE '%active spend hold%', 'a customer with an active spend hold must not be deleted');
UPDATE piggyvest_primary.wallet_spend_holds SET released_at = TIMESTAMPTZ '2026-10-31 04:00:00+00'
  WHERE id = pg_temp.id(53);

-- Everything is settled: the account deletes and the engine keeps its evidence.
DELETE FROM public.customers WHERE id = pg_temp.id(50);
SELECT pg_temp.check((SELECT customer_id IS NULL AND state = 'confirmed' AND amount_kobo = 2000 AND row_version = 3
  FROM piggyvest_primary.wallet_transfers WHERE id = :'detach_transfer'), 'the settled transfer detaches and is kept');
SELECT pg_temp.check((SELECT state = 'applied' AND wallet_transaction_id IS NULL AND applied_at IS NOT NULL
  FROM piggyvest_primary.transfer_b_effects WHERE transfer_id = :'detach_transfer'),
  'the applied effect is kept without its deleted ledger row');
SELECT pg_temp.check((SELECT customer_id IS NULL FROM piggyvest_primary.wallet_spend_holds WHERE id = pg_temp.id(53)),
  'the released hold detaches');
SELECT pg_temp.check(pg_temp.sqlstate_of(format(
  'UPDATE piggyvest_primary.wallet_transfers SET customer_id = %L WHERE id = %L', pg_temp.id(3), :'detach_transfer')) = '42501',
  'a detached transfer can never be re-pointed at another customer');
DELETE FROM piggyvest_primary.transfer_authorities WHERE executor_login = session_user;
