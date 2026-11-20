-- Run against a disposable database after the follow-up migration.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-4000-8000-000000000001','owner@example.test'),
  ('aa000000-0000-4000-8000-000000000002','staff@example.test'),
  ('aa000000-0000-4000-8000-000000000003','outsider@example.test');
SELECT set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
INSERT INTO public.merchants (id, user_id, slug, business_name, email) VALUES
  ('aa000000-0000-4000-8000-000000000012','aa000000-0000-4000-8000-000000000003','follow-up-other-store','Other test store','outsider@example.test');
SELECT set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
INSERT INTO public.merchants (id, user_id, slug, business_name, email) VALUES
  ('aa000000-0000-4000-8000-000000000011','aa000000-0000-4000-8000-000000000001','follow-up-test','Follow-up test','owner@example.test');
INSERT INTO public.staff_members (merchant_id, user_id, name, email, role, status) VALUES
  ('aa000000-0000-4000-8000-000000000011','aa000000-0000-4000-8000-000000000002','Test staff','staff@example.test','admin','active');
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, customer_email, subtotal, total, payment_status) VALUES
  ('aa000000-0000-4000-8000-000000000021','aa000000-0000-4000-8000-000000000011','ORDER-FOLLOWUP-TEST','Guest','guest@example.test',100,100,'unpaid'),
  ('aa000000-0000-4000-8000-000000000022','aa000000-0000-4000-8000-000000000011','ORDER-FOLLOWUP-ORPHAN','Guest','guest@example.test',100,100,'unpaid');
-- A column added later must not leak through the RPC responses (they return an explicit field list).
ALTER TABLE public.order_follow_ups ADD COLUMN internal_probe text NOT NULL DEFAULT 'internal';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  merchant_id constant uuid := 'aa000000-0000-4000-8000-000000000011';
  order_id constant uuid := 'aa000000-0000-4000-8000-000000000021';
  staff_id constant uuid := 'aa000000-0000-4000-8000-000000000002';
  row_data jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', staff_id::text, true);
  row_data := public.claim_order_follow_up(merchant_id, order_id);
  PERFORM public.claim_order_follow_up(merchant_id, 'aa000000-0000-4000-8000-000000000022');
  PERFORM public.update_order_follow_up(merchant_id, 'aa000000-0000-4000-8000-000000000022', 1, 'waiting', 'Awaiting a callback.', '2026-12-02');
  IF row_data->>'assignee_id' IS DISTINCT FROM staff_id::text OR row_data->>'assignee_name' IS DISTINCT FROM 'Test staff'
     OR row_data->>'stage' IS DISTINCT FROM 'needs_follow_up' THEN
    RAISE EXCEPTION 'Claim did not assign the current staff member';
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row_data) AS k) IS DISTINCT FROM ARRAY[
    'assignee_id','assignee_name','follow_up_on','merchant_id','order_id','outcome','revision','stage','updated_at'
  ] THEN
    RAISE EXCEPTION 'Claim returned more or fewer fields than the client contract';
  END IF;
  row_data := public.update_order_follow_up(merchant_id, order_id, 1, 'waiting', 'Asked the customer to retry.', '2026-12-01');
  IF row_data->>'stage' IS DISTINCT FROM 'waiting' OR row_data->>'revision' IS DISTINCT FROM '2'
     OR row_data->>'outcome' IS DISTINCT FROM 'Asked the customer to retry.'
     OR row_data->>'follow_up_on' IS DISTINCT FROM '2026-12-01' THEN
    RAISE EXCEPTION 'Follow-up update did not persist all fields';
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row_data) AS k) IS DISTINCT FROM ARRAY[
    'assignee_id','assignee_name','follow_up_on','merchant_id','order_id','outcome','revision','stage','updated_at'
  ] THEN
    RAISE EXCEPTION 'Update returned more or fewer fields than the client contract';
  END IF;
  BEGIN
    PERFORM public.update_order_follow_up(merchant_id, order_id, 2, 'waiting', 'Out of range', DATE '1899-12-31');
    RAISE EXCEPTION 'An out-of-range follow-up date was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.update_order_follow_up(merchant_id, order_id, 1, 'closed', '', NULL);
    RAISE EXCEPTION 'Stale update overwrote a newer note';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
  IF (SELECT count(*) FROM public.order_follow_ups f WHERE f.order_id = 'aa000000-0000-4000-8000-000000000021') <> 1 THEN
    RAISE EXCEPTION 'The merchant team could not read the follow-up';
  END IF;
  BEGIN
    PERFORM public.claim_order_follow_up(merchant_id, order_id);
    RAISE EXCEPTION 'An already claimed order was reassigned';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.update_order_follow_up(merchant_id, order_id, 2, 'closed', '', NULL);
    RAISE EXCEPTION 'Another team member overwrote the follow-up';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.order_follow_ups SET outcome = 'Direct write';
    RAISE EXCEPTION 'A team member bypassed the follow-up RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', staff_id::text, true);
  row_data := public.update_order_follow_up(merchant_id, order_id, 2, 'closed', 'Customer declined.', '2026-12-01');
  IF row_data->>'stage' IS DISTINCT FROM 'closed'
     OR row_data->>'follow_up_on' IS NOT NULL
     OR row_data->>'outcome' IS DISTINCT FROM 'Customer declined.' THEN
    RAISE EXCEPTION 'Closing did not keep the outcome and clear the due date';
  END IF;
  PERFORM set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000003',true);
  IF EXISTS (SELECT 1 FROM public.order_follow_ups) THEN
    RAISE EXCEPTION 'An outsider could read team follow-ups';
  END IF;
  BEGIN
    PERFORM public.claim_order_follow_up(merchant_id, order_id);
    RAISE EXCEPTION 'An outsider could claim another store order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_order_follow_up('aa000000-0000-4000-8000-000000000012', order_id);
    RAISE EXCEPTION 'An owner could claim an order outside their store';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- Account deletion must release the open follow-up and preserve its details.
DELETE FROM auth.users WHERE id = 'aa000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  row_data jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
  row_data := public.claim_order_follow_up(
    'aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000022'
  );
  IF row_data->>'assignee_id' IS DISTINCT FROM 'aa000000-0000-4000-8000-000000000001'
     OR row_data->>'stage' IS DISTINCT FROM 'waiting'
     OR row_data->>'outcome' IS DISTINCT FROM 'Awaiting a callback.'
     OR row_data->>'follow_up_on' IS DISTINCT FROM '2026-12-02' THEN
    RAISE EXCEPTION 'An orphaned follow-up could not be reclaimed with its progress kept';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT payment_status FROM public.orders WHERE id = 'aa000000-0000-4000-8000-000000000021')
     IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'Staff follow-up modified the order payment status';
  END IF;
END $$;
ROLLBACK;
