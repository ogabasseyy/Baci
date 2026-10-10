\set ON_ERROR_STOP on

DO $$
BEGIN
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'provider customer bound to second local customer';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004',
      '70000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'local customer bound to second provider customer';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$
BEGIN
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'stale snapshot provisioning accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
ROLLBACK;

INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004');
DO $$
BEGIN
  IF (SELECT goal_id FROM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000001'))
      IS DISTINCT FROM '30000000-0000-4000-8000-000000000004'::uuid THEN
    RAISE EXCEPTION 'same customer multiple plans rejected';
  END IF;
END $$;
