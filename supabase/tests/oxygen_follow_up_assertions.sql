-- Definitive checkout outcomes bypass the in-progress grace period.
INSERT INTO public.orders (id, merchant_id, payment_method, payment_status, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000047', '20000000-0000-4000-8000-000000000001', 'oxygen', 'failed', now(), now()),
  ('00000000-0000-4000-8000-000000000048', '20000000-0000-4000-8000-000000000001', 'oxygen', 'expired', now(), now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE result jsonb; actual text;
BEGIN
  SELECT jsonb_object_agg(right(order_id::text, 3), follow_up_status)
    INTO result FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001');
  FOR actual IN SELECT key FROM jsonb_each(result) LOOP
    IF actual NOT IN ('001','002','003','004','005','006','011','012','013','014','017','018','019','021','022','023','025','026','027','028','029','030','031','032','034','035','036','038','039','041','042','044','046','047','048') THEN
      RAISE EXCEPTION 'Unexpected follow-up order: %', actual;
    END IF;
  END LOOP;
  IF result IS DISTINCT FROM '{"001":"customer_action","002":"oxygen_processing","003":"oxygen_processing","004":"approved_pending","005":"needs_review","006":"needs_review","011":"customer_action","012":"needs_review","013":"needs_review","014":"needs_review","017":"oxygen_processing","018":"needs_review","019":"needs_review","021":"needs_review","022":"needs_review","023":"customer_action","025":"needs_review","026":"needs_review","027":"needs_review","028":"needs_review","029":"needs_review","030":"needs_review","031":"needs_review","032":"needs_review","034":"needs_review","035":"needs_review","036":"needs_review","038":"needs_review","039":"needs_review","041":"needs_review","042":"approved_pending","044":"needs_review","046":"needs_review","047":"needs_review","048":"needs_review"}'::jsonb THEN
    RAISE EXCEPTION 'Incorrect Oxygen follow-up statuses: %', result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') r
    WHERE (to_jsonb(r) - ARRAY['order_id','follow_up_status','last_activity_at','order_customer_id']) <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Follow-up projection leaked provider data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') r
    WHERE (r.follow_up_status <> 'customer_action' AND r.order_customer_id IS NOT NULL)
      OR (r.order_id = '00000000-0000-4000-8000-000000000001'
        AND r.order_customer_id IS DISTINCT FROM '30000000-0000-4000-8000-000000000001'::uuid)
  ) THEN
    RAISE EXCEPTION 'Unexpected customer binding in follow-up projection';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') r
    WHERE r.order_id = '00000000-0000-4000-8000-000000000032'
      AND r.follow_up_status = 'needs_review'
      AND r.last_activity_at >= now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'Indeterminate activation finished_at did not update last_activity_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') r
    WHERE r.order_id = '00000000-0000-4000-8000-000000000039'
      AND r.follow_up_status = 'needs_review'
      AND r.last_activity_at >= now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'Indeterminate payment recovery completed_at did not update last_activity_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') r
    WHERE r.order_id = '00000000-0000-4000-8000-000000000036'
      AND r.follow_up_status = 'needs_review'
      AND r.last_activity_at >= now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'Activation conflict observation did not update last_activity_at';
  END IF;
  BEGIN
    PERFORM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Foreign merchant access was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  BEGIN
    PERFORM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unauthenticated access was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.oxygen_follow_up_candidates(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can execute Oxygen follow-up';
  END IF;
  IF has_function_privilege('service_role', 'public.oxygen_follow_up_candidates(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Service role retained default execute access';
  END IF;
  IF has_table_privilege('authenticated', 'oxygen_private.provider_states', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated role can read private provider state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_orders_oxygen_follow_up_merchant_created')
      AND i.indisvalid AND i.indisready) THEN
    RAISE EXCEPTION 'Oxygen follow-up index is missing or invalid';
  END IF;
END $$;

-- A command claimed after a long queue wait has just started and is still in progress.
INSERT INTO oxygen_private.commands VALUES
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'executing', '{"action":"refresh_eligibility"}', now()-interval '2 hours', now()-interval '1 minute');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001') WHERE order_id = '00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Recently active workflow was marked for follow-up';
  END IF;
END $$;
RESET ROLE;

-- Legacy executing commands without a start timestamp fall back to queue time.
UPDATE oxygen_private.commands SET started_at = NULL
  WHERE id = '60000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
    WHERE order_id = '00000000-0000-4000-8000-000000000001' AND follow_up_status = 'needs_review') THEN
    RAISE EXCEPTION 'Stale executing command without a start time was not flagged';
  END IF;
END $$;
RESET ROLE;

-- The server, not a caller-provided limit, bounds the queue.
INSERT INTO public.orders (id, merchant_id, customer_id, payment_method, payment_status, created_at)
SELECT ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'oxygen', 'unpaid', now()-interval '2 hours'
FROM generate_series(1,260) n;
SET ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')) <> 250 THEN
    RAISE EXCEPTION 'Oxygen follow-up queue was not capped at 250';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
    WHERE order_id = '00000000-0000-4000-8000-000000000014' AND follow_up_status = 'needs_review') THEN
    RAISE EXCEPTION 'Older urgent review was crowded out by ordinary follow-ups';
  END IF;
END $$;
RESET ROLE;

-- A large urgent backlog must not consume every place in the bounded queue.
INSERT INTO public.orders (id,merchant_id,customer_id,payment_method,payment_status,created_at)
SELECT ('80000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'oxygen', 'unpaid', now()-interval '2 hours'
FROM generate_series(1,260) n;
INSERT INTO public.oxygen_workflows (id,order_id,merchant_id,customer_id,environment,stage,updated_at)
SELECT ('90000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  ('80000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'production', 'reconciliation_required', now()-interval '1 hour'
FROM generate_series(1,260) n;
SET ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
    WHERE order_id::text LIKE '70000000-%' AND follow_up_status = 'customer_action') < 100 THEN
    RAISE EXCEPTION 'Urgent backlog crowded routine follow-ups out of the queue';
  END IF;
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
    WHERE order_id::text LIKE '80000000-%' AND follow_up_status = 'needs_review') < 100 THEN
    RAISE EXCEPTION 'Urgent follow-ups were crowded out of the queue';
  END IF;
END $$;
RESET ROLE;
