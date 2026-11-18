-- Failed Oxygen orders remain reviewable regardless of checkout provenance.
BEGIN;
INSERT INTO public.orders (
  id, merchant_id, customer_id, payment_method, payment_status, created_at,
  cancelled_at, source, recorded_by_user_id, external_source, import_job_id
)
SELECT ('61000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  CASE WHEN n = 9 THEN '20000000-0000-4000-8000-000000000002'::uuid
    ELSE '20000000-0000-4000-8000-000000000001'::uuid END,
  '30000000-0000-4000-8000-000000000001'::uuid, 'oxygen',
  CASE WHEN n = 10 THEN 'unpaid' WHEN n IN (2,4,6,8) THEN 'expired' ELSE 'failed' END,
  now() - CASE WHEN n = 7 THEN interval '91 days'
    WHEN n = 10 THEN interval '2 hours' ELSE interval '1 minute' END,
  CASE WHEN n = 8 THEN now() END,
  CASE WHEN n IN (5,6) THEN NULL ELSE 'manual' END,
  CASE WHEN n IN (1,2) THEN '10000000-0000-4000-8000-000000000001'::uuid END,
  CASE WHEN n IN (5,6) THEN 'import' END,
  CASE WHEN n IN (5,6) THEN '62000000-0000-4000-8000-000000000001'::uuid END
FROM generate_series(1,10) n;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '61000000-%' AND follow_up_status = 'needs_review'
        AND order_customer_id IS NULL) <> 6 THEN
    RAISE EXCEPTION 'Staff, manual or imported Oxygen failures were omitted or misclassified';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id IN ('61000000-0000-4000-8000-000000000007',
        '61000000-0000-4000-8000-000000000008','61000000-0000-4000-8000-000000000009',
        '61000000-0000-4000-8000-000000000010')) THEN
    RAISE EXCEPTION 'Old, cancelled, foreign-merchant or unpaid manual orders entered follow-up';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- Existing BNPL follow-ups retain coverage across staff and import provenance.
BEGIN;
INSERT INTO public.orders (
  id, merchant_id, customer_id, payment_method, payment_status, created_at,
  cancelled_at, source, recorded_by_user_id, external_source, import_job_id
)
SELECT ('63000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  CASE WHEN n = 7 THEN '20000000-0000-4000-8000-000000000002'::uuid
    ELSE '20000000-0000-4000-8000-000000000001'::uuid END,
  '30000000-0000-4000-8000-000000000001'::uuid, 'oxygen', 'bnpl_pending',
  now() - CASE WHEN n = 5 THEN interval '91 days' ELSE interval '1 minute' END,
  CASE WHEN n = 6 THEN now() END,
  CASE WHEN n = 3 THEN NULL ELSE 'manual' END,
  CASE WHEN n = 1 THEN '10000000-0000-4000-8000-000000000001'::uuid END,
  CASE WHEN n = 3 THEN 'import' END,
  CASE WHEN n = 3 THEN '62000000-0000-4000-8000-000000000001'::uuid END
FROM generate_series(1,7) n;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  IF (SELECT array_agg(order_id ORDER BY order_id)
      FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '63000000-%' AND follow_up_status = 'needs_review'
        AND order_customer_id IS NULL) IS DISTINCT FROM ARRAY[
          '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000002',
          '63000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000004']::uuid[] THEN
    RAISE EXCEPTION 'Staff, manual or imported Oxygen BNPL follow-ups disappeared';
  END IF;
  IF EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id IN ('63000000-0000-4000-8000-000000000005',
        '63000000-0000-4000-8000-000000000006','63000000-0000-4000-8000-000000000007')) THEN
    RAISE EXCEPTION 'Old, cancelled or foreign-merchant BNPL orders entered follow-up';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
