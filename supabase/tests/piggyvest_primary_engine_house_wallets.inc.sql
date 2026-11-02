-- Part of piggyvest_primary_engine_schema.sql (\ir): the house-wallet registry
-- and bank destinations. Runs inside the entry file's transaction.

DO $$
BEGIN
  -- One wallet per purpose per integration.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
     VALUES (%L, %L, %L, %L, ''NGN'')', pg_temp.id(5), 'collection', 'pv-house-collection-2', 'engine-business')) = '23505',
    'a second collection wallet for one integration must be refused');
  -- A provider wallet id is registered once.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
     VALUES (%L, %L, %L, %L, ''NGN'')', pg_temp.id(5), 'fee', 'pv-house-interest', 'engine-business')) = '23505',
    'a provider wallet id must not be registered twice');
  -- House wallets are NGN wallets, stated explicitly by the owner.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
     VALUES (%L, %L, %L, %L, ''USD'')', pg_temp.id(5), 'fee', 'pv-house-usd', 'engine-business')) = '23514',
    'a house wallet in another currency must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
     VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'fee', 'pv-house-no-currency', 'engine-business')) = '23502',
    'a house wallet must state its currency');
  -- A role outside collection|interest|fee is refused.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
     VALUES (%L, %L, %L, %L, ''NGN'')', pg_temp.id(5), 'main', 'pv-house-main', 'engine-business')) = '23514',
    'an unknown house wallet role must be refused');
END $$;

-- Customer wallets are never house wallets: the main wallet, the goal wallet
-- and a goal wallet intent that is not enrolled yet are all refused.
DO $$
DECLARE
  v_wallet text;
BEGIN
  INSERT INTO piggyvest_primary.goal_wallet_intents(integration_id, goal_id, primary_intent_id, wallet_name,
    state, provider_wallet_id, interest_accepted)
  VALUES (pg_temp.id(5), pg_temp.id(21), pg_temp.id(6), 'engine-goal-wallet-name', 'accepted',
    'pv-engine-goal-intent', false);
  FOREACH v_wallet IN ARRAY ARRAY['pv-engine-main', 'pv-engine-goal', 'pv-engine-goal-intent'] LOOP
    PERFORM pg_temp.check(pg_temp.error_of(format(
      'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
       VALUES (%L, %L, %L, %L, ''NGN'')', pg_temp.id(5), 'fee', v_wallet, 'engine-business'))
      LIKE '%customer wallet%', format('customer wallet %s must be refused as a house wallet', v_wallet));
  END LOOP;
END $$;

DO $$
DECLARE
  v_id uuid;
BEGIN
  -- The business must be the integration's own.
  PERFORM pg_temp.check(pg_temp.error_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
     VALUES (%L, %L, %L, %L, ''NGN'')', pg_temp.id(5), 'fee', 'pv-house-other-business', 'another-business'))
    LIKE '%business%', 'a house wallet of another business must be refused');
  -- Enabled requires verified.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency, enabled)
     VALUES (%L, %L, %L, %L, ''NGN'', true)', pg_temp.id(5), 'fee', 'pv-house-unverified', 'engine-business')) = '23514',
    'an unverified house wallet must not be enabled');

  -- Before verification a row may still be corrected or removed.
  INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
    VALUES (pg_temp.id(5), 'fee', 'pv-house-fee-discarded', 'engine-business', 'NGN') RETURNING id INTO v_id;
  DELETE FROM piggyvest_primary.house_wallets WHERE id = v_id;
  INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, currency)
    VALUES (pg_temp.id(5), 'fee', 'pv-house-fee-draft', 'engine-business', 'NGN') RETURNING id INTO v_id;
  UPDATE piggyvest_primary.house_wallets SET provider_wallet_id = 'pv-house-fee' WHERE id = v_id;
  UPDATE piggyvest_primary.house_wallets SET verified_at = TIMESTAMPTZ '2026-10-31 00:00:00+00', enabled = true
    WHERE id = v_id;

  -- Once verified the identity is immutable and the row cannot be removed.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.house_wallets SET provider_wallet_id = %L WHERE id = %L', 'pv-house-fee-2', v_id)) = '42501',
    'a verified house wallet id must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.house_wallets SET role = %L WHERE id = %L', 'interest', v_id)) = '42501',
    'a verified house wallet role must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.house_wallets SET verified_at = NULL, enabled = false WHERE id = %L', v_id)) = '42501',
    'a verified house wallet must stay verified');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.house_wallets WHERE id = %L', v_id)) = '42501',
    'a verified house wallet must not be deleted');
  -- Only the operational switch may change: disabling and re-enabling.
  UPDATE piggyvest_primary.house_wallets SET enabled = false WHERE id = v_id;
  UPDATE piggyvest_primary.house_wallets SET enabled = true WHERE id = v_id;
END $$;

-- The kill switch always works: once a customer record also claims a
-- verified house wallet (or its integration's business changed), switching
-- it off still succeeds and switching it back on is refused.
SAVEPOINT engine_house_kill_switch;
DO $$
BEGIN
  INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
    request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(7), pg_temp.id(5), pg_temp.id(2), pg_temp.id(4), pg_temp.id(1),
    repeat('a', 64), 'verified', 'pv-engine-customer-4', 'pv-house-fee');
  UPDATE piggyvest_primary.integrations SET business_id = 'engine-business-renamed' WHERE id = pg_temp.id(5);
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'UPDATE piggyvest_primary.house_wallets SET enabled = false WHERE provider_wallet_id = ''pv-house-fee''') = 'ok',
    'switching off a house wallet must always succeed');
  PERFORM pg_temp.check(NOT (SELECT enabled FROM piggyvest_primary.house_wallets WHERE provider_wallet_id = 'pv-house-fee'),
    'the house wallet must now be off');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(
    'UPDATE piggyvest_primary.house_wallets SET enabled = true WHERE provider_wallet_id = ''pv-house-fee''') = '23514',
    'a house wallet a customer record claims must not be switched back on');
END $$;
ROLLBACK TO SAVEPOINT engine_house_kill_switch;

-- The read helper answers only a login with an enabled authority for the
-- integration, and returns every registered wallet with its readiness.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format('SELECT * FROM piggyvest_primary.read_house_wallets(%L)',
    pg_temp.id(5))) = '42501', 'a login without an authority must not read house wallets');
  INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
    VALUES (pg_temp.id(5), 'ops', session_user, false);
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format('SELECT * FROM piggyvest_primary.read_house_wallets(%L)',
    pg_temp.id(5))) = '42501', 'a disabled authority must not read house wallets');
  UPDATE piggyvest_primary.transfer_authorities SET enabled = true WHERE executor_login = session_user;
  PERFORM pg_temp.check((SELECT count(*) FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))) = 3,
    'read_house_wallets must return the three registered wallets');
  PERFORM pg_temp.check((SELECT bool_and(enabled AND verified)
    FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))), 'the fixture wallets must read as ready');
  PERFORM pg_temp.check((SELECT provider_wallet_id || ':' || currency FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))
    WHERE role = 'collection') = 'pv-house-collection:NGN', 'the collection wallet id and currency must read back');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format('SELECT * FROM piggyvest_primary.read_house_wallets(%L)',
    pg_temp.id(12))) = '42501', 'an integration the login has no authority for must not be read');
  DELETE FROM piggyvest_primary.transfer_authorities WHERE executor_login = session_user;
END $$;

-- A wallet registered for the integration's previous business is listed but
-- does not read as verified, so a registry built from it is never ready.
SAVEPOINT engine_house_reader_business;
INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
  VALUES (pg_temp.id(5), 'ops', session_user, true);
UPDATE piggyvest_primary.integrations SET business_id = 'engine-business-renamed' WHERE id = pg_temp.id(5);
SELECT pg_temp.check((SELECT count(*) FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))) = 3
  AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.read_house_wallets(pg_temp.id(5)) WHERE verified),
  'a house wallet of the integration''s previous business must not read as verified');
ROLLBACK TO SAVEPOINT engine_house_reader_business;

-- Bank destinations: a treasury account has no customer, a support payout
-- account belongs to one, and a verified account is immutable.
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.bank_destinations(integration_id, purpose, customer_id, bank_code, account_number, account_name)
     VALUES (%L, %L, %L, %L, %L, %L)', pg_temp.id(5), 'treasury', pg_temp.id(3), '058', '1111111111', 'Wrong')) = '23514',
    'a treasury destination must not belong to a customer');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.bank_destinations(integration_id, purpose, customer_id, bank_code, account_number, account_name)
     VALUES (%L, %L, %L, %L, %L, %L)', pg_temp.id(5), 'support_payout', pg_temp.id(13), '058', '2222222222', 'Other')) <> 'ok',
    'a support payout destination of another merchant''s customer must be refused');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'UPDATE piggyvest_primary.bank_destinations SET account_number = %L WHERE id = %L', '3333333333', pg_temp.id(41))) = '42501',
    'a verified bank destination must be immutable');
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'DELETE FROM piggyvest_primary.bank_destinations WHERE id = %L', pg_temp.id(41))) = '42501',
    'a verified bank destination must not be deleted');
END $$;
