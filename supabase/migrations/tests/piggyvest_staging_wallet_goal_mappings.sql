\set ON_ERROR_STOP on

INSERT INTO public.merchants (id) VALUES
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers (id, merchant_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled) VALUES
  ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', true),
  ('40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', true),
  ('40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', false);

DO $$
DECLARE
  fixture record;
BEGIN
  FOR fixture IN SELECT cases.merchant_id, cases.customer_id, cases.goal_id FROM (VALUES
    ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'),
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003'),
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000009')
  ) AS cases(merchant_id, customer_id, goal_id) LOOP
    BEGIN
      INSERT INTO piggyvest_staging.wallet_goal_mappings
        (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
      VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000001', fixture.merchant_id::uuid, fixture.customer_id::uuid, fixture.goal_id::uuid);
      RAISE EXCEPTION 'invalid local ownership accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END $$;

INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002');

DO $$
DECLARE
  integration uuid;
  identity text;
  column_name text;
BEGIN
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'one provider wallet mapped to two goals';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
    VALUES ('40000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000004',
      '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'goal mapped to second wallet across integrations';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  FOREACH integration IN ARRAY ARRAY['40000000-0000-4000-8000-000000000003'::uuid,
    '40000000-0000-4000-8000-000000000009'::uuid] LOOP
    BEGIN
      INSERT INTO piggyvest_staging.wallet_goal_mappings
        (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
      VALUES (integration, '60000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000004');
      RAISE EXCEPTION 'disabled or unregistered provisioning accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  FOREACH column_name IN ARRAY ARRAY['integration_id', 'provider_wallet_id', 'provider_customer_id',
    'merchant_id', 'customer_id', 'goal_id'] LOOP
    BEGIN
      EXECUTE pg_catalog.format('UPDATE piggyvest_staging.wallet_goal_mappings SET %I = %L',
        column_name, '90000000-0000-4000-8000-000000000009');
      RAISE EXCEPTION 'ownership mutation accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    DELETE FROM piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'delete permits wallet reassignment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    TRUNCATE piggyvest_staging.wallet_goal_mappings;
    RAISE EXCEPTION 'truncate permits wallet reassignment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  FOREACH identity IN ARRAY ARRAY[NULL::text, '', pg_catalog.repeat('0', 513), pg_catalog.repeat(chr(233), 257)] LOOP
    BEGIN
      INSERT INTO piggyvest_staging.wallet_goal_mappings
        (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
      VALUES ('40000000-0000-4000-8000-000000000001', identity, '70000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000004');
      RAISE EXCEPTION 'invalid provider identity accepted';
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
    BEGIN
      INSERT INTO piggyvest_staging.wallet_goal_mappings
        (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
      VALUES ('40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', identity,
        '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000004');
      RAISE EXCEPTION 'invalid provider customer identity accepted';
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
  END LOOP;
END $$;

BEGIN;
INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id)
VALUES ('40000000-0000-4000-8000-000000000001', pg_catalog.repeat(chr(233), 256), pg_catalog.repeat('0', 512),
  '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000003');
DO $$
BEGIN
  IF (SELECT count(*) FROM piggyvest_staging.resolve_wallet_mapping('40000000-0000-4000-8000-000000000001',
    pg_catalog.repeat(chr(233), 256), pg_catalog.repeat('0', 512))) <> 1 THEN
    RAISE EXCEPTION 'maximum byte length identities failed';
  END IF;
END $$;
ROLLBACK;
