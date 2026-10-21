-- Durable network-origin budget: one (merchant, caller-network) pair admits
-- 10 requests per fixed hourly window; the 11th raises 54000 while a
-- different origin or a different merchant is unaffected. Retries of an
-- admitted request id consume no budget; malformed hashes fail validation.
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('02d00000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'intake-net-owner-a@example.com', 'test',
  now(), now(), now(), '{}', '{}'),
('02d00000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'intake-net-owner-b@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('02d00000-0000-4000-8000-000000000011', '02d00000-0000-4000-8000-000000000001',
  'intake-net-a@example.com', 'Intake Net A', 'intake-net-a', true),
('02d00000-0000-4000-8000-000000000012', '02d00000-0000-4000-8000-000000000002',
  'intake-net-b@example.com', 'Intake Net B', 'intake-net-b', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

-- Ten admissions from one origin succeed (distinct contacts/queries/ids so
-- only the network budget is under test).
DO $$ DECLARE i integer; BEGIN
  FOR i IN 0..9 LOOP
    PERFORM public.submit_storefront_product_request(
      'intake-net-a', 'Need budget item ' || i, 'netbudget' || i || '@example.com',
      ('02d00000-0000-4000-8000-' || lpad(to_hex(256 + i), 12, '0'))::uuid,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  END LOOP;
END $$;

-- The 11th request from the same origin raises the budget code.
DO $$ BEGIN
  BEGIN
    PERFORM public.submit_storefront_product_request(
      'intake-net-a', 'Need one more item', 'netbudget-extra@example.com',
      '02d00000-0000-4000-8000-000000000300',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  EXCEPTION WHEN SQLSTATE '54000' THEN
    RETURN;
  END;
  RAISE EXCEPTION '11th request from one origin must raise 54000';
END $$;

-- An exact-id retry of an admitted request still succeeds and consumes no
-- further budget (ledger count for the origin is unchanged).
DO $$ DECLARE before_count integer; after_count integer; BEGIN
  SELECT request_count INTO before_count
    FROM storefront_search_private.intake_net_windows
    WHERE merchant_id = '02d00000-0000-4000-8000-000000000011'
      AND net_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      AND window_start = date_trunc('hour', now());
  IF before_count <> 10 THEN
    RAISE EXCEPTION 'expected ledger count 10, got %', before_count;
  END IF;
  PERFORM public.submit_storefront_product_request(
    'intake-net-a', 'Need budget item 0', 'netbudget0@example.com',
    ('02d00000-0000-4000-8000-' || lpad(to_hex(256), 12, '0'))::uuid,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  SELECT request_count INTO after_count
    FROM storefront_search_private.intake_net_windows
    WHERE merchant_id = '02d00000-0000-4000-8000-000000000011'
      AND net_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      AND window_start = date_trunc('hour', now());
  IF after_count <> 10 THEN
    RAISE EXCEPTION 'retry consumed budget: ledger count %', after_count;
  END IF;
END $$;

-- A different origin against the same merchant is unaffected.
SELECT public.submit_storefront_product_request(
  'intake-net-a', 'Need origin B item', 'netbudget-b@example.com',
  '02d00000-0000-4000-8000-000000000301',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

-- The same origin against a different merchant is unaffected (per-merchant
-- scoping: the hash alone never exhausts another merchant's intake).
SELECT public.submit_storefront_product_request(
  'intake-net-b', 'Need sibling item', 'netbudget-sibling@example.com',
  '02d00000-0000-4000-8000-000000000302',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Malformed and missing hashes fail closed as validation errors.
DO $$ DECLARE bad_seen boolean := false; null_seen boolean := false; BEGIN
  BEGIN
    PERFORM public.submit_storefront_product_request(
      'intake-net-a', 'Need bad hash item', 'netbudget-bad@example.com',
      '02d00000-0000-4000-8000-000000000303', 'not-a-hash');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    bad_seen := true;
  END;
  BEGIN
    PERFORM public.submit_storefront_product_request(
      'intake-net-a', 'Need null hash item', 'netbudget-null@example.com',
      '02d00000-0000-4000-8000-000000000304', NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    null_seen := true;
  END;
  IF NOT (bad_seen AND null_seen) THEN
    RAISE EXCEPTION 'malformed and null net hashes must raise 22023';
  END IF;
END $$;

-- Cross-overload retries during rollout: a request admitted through the
-- deprecated 4-arg shim retries cleanly through the 5-arg RPC under the
-- same id (and vice versa), consuming no network budget either way.
SELECT public.submit_storefront_product_request(
  'intake-net-b', 'Need shim crossover', 'netbudget-shim@example.com',
  '02d00000-0000-4000-8000-000000000305');
SELECT public.submit_storefront_product_request(
  'intake-net-b', 'Need shim crossover', 'netbudget-shim@example.com',
  '02d00000-0000-4000-8000-000000000305',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
SELECT public.submit_storefront_product_request(
  'intake-net-b', 'Need shim reverse', 'netbudget-reverse@example.com',
  '02d00000-0000-4000-8000-000000000306',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
SELECT public.submit_storefront_product_request(
  'intake-net-b', 'Need shim reverse', 'netbudget-reverse@example.com',
  '02d00000-0000-4000-8000-000000000306');
DO $$ BEGIN
  -- Merchant B admitted exactly twice (sibling + reverse); both same-id
  -- crossover retries consumed nothing.
  IF (SELECT COALESCE(sum(request_count), 0)
      FROM storefront_search_private.intake_net_windows
      WHERE merchant_id = '02d00000-0000-4000-8000-000000000012') <> 2 THEN
    RAISE EXCEPTION 'crossover retries must not consume network budget';
  END IF;
END $$;

-- Prune collects expired windows across merchants but keeps the current one.
INSERT INTO storefront_search_private.intake_net_windows
  (merchant_id, net_hash, window_start, request_count)
VALUES ('02d00000-0000-4000-8000-000000000011',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  date_trunc('hour', now()) - interval '2 hours', 10);
SELECT storefront_search_private.prune_intake_net_windows();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storefront_search_private.intake_net_windows
      WHERE window_start < date_trunc('hour', now())) THEN
    RAISE EXCEPTION 'prune must collect expired windows';
  END IF;
  IF (SELECT COALESCE(sum(request_count), 0)
      FROM storefront_search_private.intake_net_windows
      WHERE merchant_id = '02d00000-0000-4000-8000-000000000011') <> 10 THEN
    RAISE EXCEPTION 'prune must keep the current window';
  END IF;
END $$;

-- One prune call collects at most 200 rows, so a large expired backlog
-- never couples one admission's latency to total expired volume.
INSERT INTO storefront_search_private.intake_net_windows
  (merchant_id, net_hash, window_start, request_count)
SELECT '02d00000-0000-4000-8000-000000000011',
  md5('prune-batch-a' || g) || md5('prune-batch-b' || g),
  date_trunc('hour', now()) - interval '2 hours', 1
FROM generate_series(1, 250) g;
SELECT storefront_search_private.prune_intake_net_windows();
DO $$ BEGIN
  IF (SELECT count(*) FROM storefront_search_private.intake_net_windows
      WHERE window_start < date_trunc('hour', now())) <> 50 THEN
    RAISE EXCEPTION 'prune must collect exactly one 200-row batch';
  END IF;
END $$;
SELECT storefront_search_private.prune_intake_net_windows();

-- Exactly fourteen rows persisted (10 + origin-B + sibling merchant + 2 crossover).
DO $$ BEGIN
  IF (SELECT count(*) FROM public.storefront_product_requests
      WHERE merchant_id IN ('02d00000-0000-4000-8000-000000000011',
                            '02d00000-0000-4000-8000-000000000012')) <> 14 THEN
    RAISE EXCEPTION 'expected exactly 14 intake rows';
  END IF;
END $$;
