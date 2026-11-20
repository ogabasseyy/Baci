BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('aa550000-0000-4000-8000-000000000001', 'follow-up-owner@example.test'),
  ('aa550000-0000-4000-8000-000000000002', 'follow-up-editor@example.test'),
  ('aa550000-0000-4000-8000-000000000003', 'follow-up-viewer@example.test');
SELECT set_config('request.jwt.claim.sub', 'aa550000-0000-4000-8000-000000000001', true);
INSERT INTO public.merchants (id, user_id, slug, business_name, email) VALUES
  ('aa550000-0000-4000-8000-000000000011', 'aa550000-0000-4000-8000-000000000001', 'follow-up-permission-test', 'Follow-up permission test', 'follow-up-owner@example.test');
INSERT INTO public.staff_members (merchant_id, user_id, name, email, role, status, permissions) VALUES
  ('aa550000-0000-4000-8000-000000000011', 'aa550000-0000-4000-8000-000000000002', 'Editor', 'follow-up-editor@example.test', 'admin', 'active', '{"customers":{"view":true,"edit":true}}'),
  ('aa550000-0000-4000-8000-000000000011', 'aa550000-0000-4000-8000-000000000003', 'Viewer', 'follow-up-viewer@example.test', 'admin', 'active', '{"customers":{"view":true,"edit":false}}');
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, customer_email, subtotal, total, payment_status) VALUES
  ('aa550000-0000-4000-8000-000000000021', 'aa550000-0000-4000-8000-000000000011', 'TEST-FOLLOWUP-OPEN', 'Guest', 'guest@example.test', 100, 100, 'unpaid'),
  ('aa550000-0000-4000-8000-000000000022', 'aa550000-0000-4000-8000-000000000011', 'TEST-FOLLOWUP-CLOSED', 'Guest', 'guest@example.test', 100, 100, 'unpaid');
-- Simulate a claim made before the permission change, to test the update RPC independently.
INSERT INTO public.order_follow_ups (order_id, merchant_id, assignee_id, assignee_name)
VALUES ('aa550000-0000-4000-8000-000000000022', 'aa550000-0000-4000-8000-000000000011', 'aa550000-0000-4000-8000-000000000003', 'Viewer');

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  store_id constant uuid := 'aa550000-0000-4000-8000-000000000011';
  open_id constant uuid := 'aa550000-0000-4000-8000-000000000021';
  legacy_id constant uuid := 'aa550000-0000-4000-8000-000000000022';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'aa550000-0000-4000-8000-000000000003', true);
  IF NOT EXISTS (SELECT 1 FROM public.order_follow_ups WHERE order_id = legacy_id) THEN
    RAISE EXCEPTION 'A viewer lost access to shared details';
  END IF;
  BEGIN
    PERFORM public.claim_order_follow_up(store_id, open_id);
    RAISE EXCEPTION 'A viewer claimed a follow-up';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.update_order_follow_up(store_id, legacy_id, 1, 'waiting', 'Bad write', NULL);
    RAISE EXCEPTION 'A viewer changed a follow-up';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', 'aa550000-0000-4000-8000-000000000002', true);
  PERFORM public.claim_order_follow_up(store_id, open_id);
  PERFORM public.update_order_follow_up(store_id, open_id, 1, 'waiting', 'Call back', DATE '2026-12-02');
END
$$;
RESET ROLE;

UPDATE public.order_follow_ups SET stage = 'closed', assignee_id = NULL
WHERE order_id = 'aa550000-0000-4000-8000-000000000022';
UPDATE public.staff_members SET status = 'removed'
WHERE user_id = 'aa550000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  store_id constant uuid := 'aa550000-0000-4000-8000-000000000011';
  open_id constant uuid := 'aa550000-0000-4000-8000-000000000021';
  owner_id constant uuid := 'aa550000-0000-4000-8000-000000000001';
  record_data jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.order_follow_ups WHERE order_id = open_id AND assignee_id IS NULL AND revision = 3) THEN
    RAISE EXCEPTION 'Offboarding did not release and version the open claim';
  END IF;
  record_data := public.claim_order_follow_up(store_id, open_id);
  IF record_data->>'assignee_id' IS DISTINCT FROM owner_id::text
    OR record_data->>'stage' IS DISTINCT FROM 'waiting'
    OR record_data->>'outcome' IS DISTINCT FROM 'Call back'
    OR record_data->>'follow_up_on' IS DISTINCT FROM '2026-12-02'
    OR record_data->>'revision' IS DISTINCT FROM '4'
  THEN
    RAISE EXCEPTION 'Reclaim changed the saved outcome or failed to assign the owner';
  END IF;
  BEGIN
    PERFORM public.claim_order_follow_up(store_id, 'aa550000-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'A closed orphan was reclaimed';
  EXCEPTION WHEN SQLSTATE 'PT410' THEN NULL;
  END;
END
$$;
ROLLBACK;
