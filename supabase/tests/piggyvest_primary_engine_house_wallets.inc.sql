-- Part of piggyvest_primary_engine_schema.sql (\ir): the house-wallet registry
-- and bank destinations. Runs inside the entry file's transaction.

DO $$
BEGIN
  -- One wallet per purpose per integration.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
     VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'collection', 'pv-house-collection-2', 'engine-business')) = '23505',
    'a second collection wallet for one integration must be refused');
  -- A provider wallet id is registered once.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
     VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'fee', 'pv-house-interest', 'engine-business')) = '23505',
    'a provider wallet id must not be registered twice');
  -- A role outside collection|interest|fee is refused.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
     VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'main', 'pv-house-main', 'engine-business')) = '23514',
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
      'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
       VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'fee', v_wallet, 'engine-business'))
      LIKE '%customer wallet%', format('customer wallet %s must be refused as a house wallet', v_wallet));
  END LOOP;
END $$;

DO $$
DECLARE
  v_id uuid;
BEGIN
  -- The business must be the integration's own.
  PERFORM pg_temp.check(pg_temp.error_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
     VALUES (%L, %L, %L, %L)', pg_temp.id(5), 'fee', 'pv-house-other-business', 'another-business'))
    LIKE '%business%', 'a house wallet of another business must be refused');
  -- Enabled requires verified.
  PERFORM pg_temp.check(pg_temp.sqlstate_of(format(
    'INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id, enabled)
     VALUES (%L, %L, %L, %L, true)', pg_temp.id(5), 'fee', 'pv-house-unverified', 'engine-business')) = '23514',
    'an unverified house wallet must not be enabled');

  -- Before verification a row may still be corrected or removed.
  INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
    VALUES (pg_temp.id(5), 'fee', 'pv-house-fee-discarded', 'engine-business') RETURNING id INTO v_id;
  DELETE FROM piggyvest_primary.house_wallets WHERE id = v_id;
  INSERT INTO piggyvest_primary.house_wallets(integration_id, role, provider_wallet_id, business_id)
    VALUES (pg_temp.id(5), 'fee', 'pv-house-fee-draft', 'engine-business') RETURNING id INTO v_id;
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

-- The read helper returns every registered wallet with its readiness.
DO $$
BEGIN
  PERFORM pg_temp.check((SELECT count(*) FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))) = 3,
    'read_house_wallets must return the three registered wallets');
  PERFORM pg_temp.check((SELECT bool_and(enabled AND verified)
    FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))), 'the fixture wallets must read as ready');
  PERFORM pg_temp.check((SELECT provider_wallet_id FROM piggyvest_primary.read_house_wallets(pg_temp.id(5))
    WHERE role = 'collection') = 'pv-house-collection', 'the collection wallet id must read back');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM piggyvest_primary.read_house_wallets(pg_temp.id(12))),
    'an unknown integration must read no house wallets');
END $$;

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
