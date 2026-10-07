\set ON_ERROR_STOP on
SET lock_timeout = '200ms';
CREATE TEMP TABLE expected_lock (blocked boolean NOT NULL);
INSERT INTO expected_lock (blocked) VALUES (:expect_lock);
DO $$
BEGIN
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000006',
      '70000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'concurrent conflicting customer mapping accepted';
  EXCEPTION
    WHEN lock_not_available THEN
      IF NOT (SELECT blocked FROM expected_lock) THEN
        RAISE EXCEPTION 'unexpected lock after provisioning committed';
      END IF;
    WHEN check_violation THEN
      IF (SELECT blocked FROM expected_lock) THEN
        RAISE EXCEPTION 'expected serialization on registry lock';
      END IF;
  END;
END $$;
