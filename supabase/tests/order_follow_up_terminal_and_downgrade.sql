BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS db_role
    WHERE has_function_privilege(db_role, 'private.normalize_order_follow_up_name()', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'A client role can execute the private handler-label trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.order_follow_ups_open_due_idx')
      AND i.indrelid = 'public.order_follow_ups'::regclass
      AND i.indisvalid AND i.indnkeyatts = 3 AND i.indoption[1] = 0
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'merchant_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'follow_up_on'
      AND pg_get_indexdef(i.indexrelid, 3, true) = 'order_id'
      AND position('stage <> ''closed''' IN pg_get_expr(i.indpred, i.indrelid)) > 0
  ) THEN
    RAISE EXCEPTION 'The bounded open follow-up scan is missing its ordered partial index';
  END IF;
END
$$;

-- Use the same defaults in both the replayed schema and a disposable fixture.
UPDATE public.role_permissions SET permissions = permissions || '{"customers":{"view":true,"edit":true}}'
WHERE role = 'admin';
INSERT INTO auth.users (id, email) VALUES
  ('aa560000-0000-4000-8000-000000000001', 'follow-up-owner@example.test'),
  ('aa560000-0000-4000-8000-000000000002', 'follow-up-editor@example.test'),
  ('aa560000-0000-4000-8000-000000000003', 'follow-up-no-view@example.test');
SELECT set_config('request.jwt.claim.sub', 'aa560000-0000-4000-8000-000000000001', true);
INSERT INTO public.merchants (id, user_id, slug, business_name, email) VALUES
  ('aa560000-0000-4000-8000-000000000011', 'aa560000-0000-4000-8000-000000000001', 'follow-up-terminal-test', 'Follow-up terminal test', 'follow-up-owner@example.test');
INSERT INTO public.staff_members (merchant_id, user_id, name, email, role, status, permissions) VALUES
  ('aa560000-0000-4000-8000-000000000011', 'aa560000-0000-4000-8000-000000000002', 'Editor', 'follow-up-editor@example.test', 'admin', 'active', '{"customers":{"view":true,"edit":true}}'),
  ('aa560000-0000-4000-8000-000000000011', 'aa560000-0000-4000-8000-000000000003', 'No view', 'follow-up-no-view@example.test', 'admin', 'active', '{"customers":{"view":false,"edit":true}}');
INSERT INTO public.orders (id, merchant_id, order_number, customer_name, customer_email, subtotal, total, payment_status) VALUES
  ('aa560000-0000-4000-8000-000000000021', 'aa560000-0000-4000-8000-000000000011', 'TEST-TEAM-OPEN', 'Guest', 'guest@example.test', 100, 100, 'unpaid'),
  ('aa560000-0000-4000-8000-000000000022', 'aa560000-0000-4000-8000-000000000011', 'TEST-TEAM-CLOSED', 'Guest', 'guest@example.test', 100, 100, 'unpaid');

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  store_id constant uuid := 'aa560000-0000-4000-8000-000000000011';
  editor_id constant uuid := 'aa560000-0000-4000-8000-000000000002';
  open_id constant uuid := 'aa560000-0000-4000-8000-000000000021';
  closed_id constant uuid := 'aa560000-0000-4000-8000-000000000022';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', editor_id::text, true);
  PERFORM public.claim_order_follow_up(store_id, open_id);
  PERFORM public.update_order_follow_up(store_id, open_id, 1, 'waiting', 'Call back', DATE '2026-12-02');
  PERFORM public.claim_order_follow_up(store_id, closed_id);
  PERFORM public.update_order_follow_up(store_id, closed_id, 1, 'closed', 'Done', NULL);

  PERFORM set_config('request.jwt.claim.sub', 'aa560000-0000-4000-8000-000000000003', true);
  IF EXISTS (SELECT 1 FROM public.order_follow_ups WHERE merchant_id = store_id) THEN
    RAISE EXCEPTION 'Staff without customer view can read follow-ups';
  END IF;
  BEGIN
    PERFORM public.claim_order_follow_up(store_id, open_id);
    RAISE EXCEPTION 'Staff without customer view can claim follow-ups';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', editor_id::text, true);
  BEGIN
    PERFORM public.update_order_follow_up(store_id, closed_id, 2, 'waiting', 'Reopened', NULL);
    RAISE EXCEPTION 'A terminal follow-up was changed';
  EXCEPTION WHEN SQLSTATE 'PT410' THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_order_follow_up(store_id, closed_id);
    RAISE EXCEPTION 'A terminal follow-up was claimed';
  EXCEPTION WHEN SQLSTATE 'PT410' THEN NULL;
  END;
END
$$;
RESET ROLE;

-- A sparse override must preserve sibling actions from the role.
UPDATE public.staff_members SET permissions = '{"customers":{"create":false}}'
WHERE user_id = 'aa560000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  store_id constant uuid := 'aa560000-0000-4000-8000-000000000011';
  editor_id constant uuid := 'aa560000-0000-4000-8000-000000000002';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', editor_id::text, true);
  IF NOT public.check_staff_permission(editor_id, store_id, 'customers', 'view')
    OR NOT public.check_staff_permission(editor_id, store_id, 'customers', 'edit')
    OR NOT EXISTS (
      SELECT 1 FROM public.order_follow_ups
      WHERE order_id = 'aa560000-0000-4000-8000-000000000021'
        AND assignee_id = editor_id AND revision = 2
    )
  THEN
    RAISE EXCEPTION 'A sparse customer override removed inherited access or released the claim';
  END IF;
END
$$;
RESET ROLE;

UPDATE public.staff_members SET permissions = '{"customers":{"view":true,"edit":false}}'
WHERE user_id = 'aa560000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  store_id constant uuid := 'aa560000-0000-4000-8000-000000000011';
  open_id constant uuid := 'aa560000-0000-4000-8000-000000000021';
  closed_id constant uuid := 'aa560000-0000-4000-8000-000000000022';
  reassigned jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'aa560000-0000-4000-8000-000000000001', true);
  IF NOT EXISTS (SELECT 1 FROM public.order_follow_ups WHERE order_id = open_id AND assignee_id IS NULL AND assignee_name = 'Unassigned' AND revision = 3) THEN
    RAISE EXCEPTION 'Revoking edit permission did not release the open claim';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_follow_ups WHERE order_id = closed_id AND assignee_id = 'aa560000-0000-4000-8000-000000000002' AND revision = 2) THEN
    RAISE EXCEPTION 'The permission change rewrote closed history';
  END IF;
  reassigned := public.claim_order_follow_up(store_id, open_id);
  IF reassigned->>'outcome' IS DISTINCT FROM 'Call back'
    OR reassigned->>'follow_up_on' IS DISTINCT FROM '2026-12-02'
    OR reassigned->>'revision' IS DISTINCT FROM '4'
  THEN
    RAISE EXCEPTION 'Reclaim did not preserve the outcome and date';
  END IF;
END
$$;

RESET ROLE;

-- A teammate may read follow-up labels without access to the staff directory.
UPDATE public.staff_members SET name = 'Staff <staff@example.invalid>', permissions = '{}'
WHERE user_id = 'aa560000-0000-4000-8000-000000000002';
UPDATE public.order_follow_ups SET assignee_id = NULL
WHERE order_id = 'aa560000-0000-4000-8000-000000000021';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  row_data jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'aa560000-0000-4000-8000-000000000002', true);
  row_data := public.claim_order_follow_up(
    'aa560000-0000-4000-8000-000000000011', 'aa560000-0000-4000-8000-000000000021'
  );
  IF row_data->>'assignee_name' IS DISTINCT FROM 'Team member' THEN
    RAISE EXCEPTION 'The assignee label exposed a formatted email address';
  END IF;
  IF public.can_write_order_follow_ups('aa560000-0000-4000-8000-000000000011') IS NOT TRUE THEN
    RAISE EXCEPTION 'An eligible staff member did not receive write capability';
  END IF;
END
$$;
RESET ROLE;

-- Updating role defaults must release active members' claims too.
UPDATE public.role_permissions
SET permissions = jsonb_set(permissions, '{customers,edit}', 'false')
WHERE role = 'admin';

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'aa560000-0000-4000-8000-000000000002', true);
  IF public.can_write_order_follow_ups('aa560000-0000-4000-8000-000000000011') IS NOT FALSE THEN
    RAISE EXCEPTION 'A view-only staff member received write capability';
  END IF;
END
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.order_follow_ups
    WHERE order_id = 'aa560000-0000-4000-8000-000000000021'
      AND assignee_id IS NULL AND assignee_name = 'Unassigned'
      AND revision = 6 AND outcome = 'Call back'
  ) THEN
    RAISE EXCEPTION 'A role-wide change stranded the open follow-up';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_follow_ups
    WHERE order_id = 'aa560000-0000-4000-8000-000000000022'
      AND assignee_id = 'aa560000-0000-4000-8000-000000000002'
      AND revision = 2 AND stage = 'closed'
  ) THEN
    RAISE EXCEPTION 'A role-wide change rewrote a closed follow-up';
  END IF;
END
$$;
ROLLBACK;
