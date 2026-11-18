-- Independent categories retain capacity even with a large manual-failure backlog.
BEGIN;
INSERT INTO public.orders (id, merchant_id, customer_id, payment_method, payment_status, source, created_at)
SELECT ('71000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'oxygen', 'failed', 'manual', now()-interval '1 minute'
FROM generate_series(1,260) n;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')) <> 250 THEN
    RAISE EXCEPTION 'Shared queue capacity was not capped at 250';
  END IF;
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '80000000-%' AND follow_up_status = 'needs_review') < 100 THEN
    RAISE EXCEPTION 'Manual failures crowded urgent reviews out of the queue';
  END IF;
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '70000000-%' AND follow_up_status = 'customer_action') < 50 THEN
    RAISE EXCEPTION 'Review-only failures crowded actionable follow-ups out of the queue';
  END IF;
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '71000000-%' AND follow_up_status = 'needs_review') < 50 THEN
    RAISE EXCEPTION 'Review-only failures have no reserved routine capacity';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
