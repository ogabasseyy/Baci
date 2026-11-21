-- Honor customer edit permissions and keep unfinished work claimable after offboarding.
CREATE OR REPLACE FUNCTION private.can_edit_order_follow_up(p_actor uuid, p_merchant uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Hold the active membership through the write. A concurrent offboarding
  -- transaction waits for the claim/update and then releases the assignment.
  PERFORM 1 FROM public.staff_members s
  WHERE s.merchant_id = p_merchant AND s.user_id = p_actor AND s.status = 'active'
  ORDER BY s.id
  FOR SHARE;

  RETURN public.check_staff_permission(p_actor, p_merchant, 'customers', 'edit');
END;
$$;
REVOKE ALL ON FUNCTION private.can_edit_order_follow_up(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.release_removed_staff_follow_ups()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'active' OR OLD.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'active'
      AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
      AND NEW.merchant_id = OLD.merchant_id THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE public.order_follow_ups AS f
  SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
  WHERE f.merchant_id = OLD.merchant_id AND f.assignee_id = OLD.user_id
    AND f.stage <> 'closed'
    AND NOT EXISTS (
      SELECT 1 FROM public.merchants m WHERE m.id = f.merchant_id AND m.user_id = f.assignee_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_members s
      WHERE s.merchant_id = f.merchant_id AND s.user_id = f.assignee_id AND s.status = 'active'
    );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.release_removed_staff_follow_ups() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS release_removed_staff_follow_ups ON public.staff_members;
CREATE TRIGGER release_removed_staff_follow_ups
AFTER UPDATE OF status, user_id, merchant_id OR DELETE ON public.staff_members
FOR EACH ROW EXECUTE FUNCTION private.release_removed_staff_follow_ups();

-- Release stale open assignments created before the offboarding trigger.
UPDATE public.order_follow_ups AS f
SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
WHERE f.assignee_id IS NOT NULL AND f.stage <> 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = f.merchant_id AND m.user_id = f.assignee_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_members s
    WHERE s.merchant_id = f.merchant_id AND s.user_id = f.assignee_id AND s.status = 'active'
  );

CREATE OR REPLACE FUNCTION public.claim_order_follow_up(p_merchant_id uuid, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  display_name text;
  claimed_by uuid;
  result jsonb;
BEGIN
  IF actor IS NULL OR private.can_edit_order_follow_up(actor, p_merchant_id) IS NOT TRUE OR NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'Follow-up unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    (SELECT coalesce(nullif(btrim(s.name), ''), nullif(btrim(s.email), ''))
     FROM public.staff_members s
     WHERE s.merchant_id = p_merchant_id AND s.user_id = actor AND s.status = 'active'
     ORDER BY s.id LIMIT 1),
    (SELECT coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(u.email), ''))
     FROM auth.users u WHERE u.id = actor),
    'Team member'
  ) INTO display_name;

  INSERT INTO public.order_follow_ups AS f (merchant_id, order_id, assignee_id, assignee_name)
  VALUES (p_merchant_id, p_order_id, actor, left(display_name, 160))
  ON CONFLICT (order_id) DO UPDATE SET
    assignee_id = excluded.assignee_id,
    assignee_name = excluded.assignee_name,
    revision = f.revision + 1,
    updated_at = clock_timestamp()
  WHERE f.merchant_id = p_merchant_id AND f.assignee_id IS NULL
    AND f.stage <> 'closed';

  -- Explicit client contract: a column added to the table later is not returned.
  SELECT f.assignee_id, jsonb_build_object(
    'order_id', f.order_id,
    'merchant_id', f.merchant_id,
    'assignee_id', f.assignee_id,
    'assignee_name', f.assignee_name,
    'stage', f.stage,
    'outcome', f.outcome,
    'follow_up_on', f.follow_up_on,
    'revision', f.revision,
    'updated_at', f.updated_at
  ) INTO claimed_by, result
  FROM public.order_follow_ups f
  WHERE f.merchant_id = p_merchant_id AND f.order_id = p_order_id AND f.stage <> 'closed';
  IF NOT FOUND OR claimed_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Follow-up already claimed' USING ERRCODE = '23505';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_follow_up(
  p_merchant_id uuid, p_order_id uuid, p_revision integer, p_stage text,
  p_outcome text, p_follow_up_on date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  result jsonb;
BEGIN
  IF actor IS NULL OR private.can_edit_order_follow_up(actor, p_merchant_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Follow-up unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('needs_follow_up', 'contacted', 'waiting', 'closed')
     OR p_outcome IS NULL OR char_length(btrim(p_outcome)) > 1000
     OR p_revision IS NULL OR p_revision < 1 THEN
    RAISE EXCEPTION 'Invalid follow-up' USING ERRCODE = '22023';
  END IF;
  UPDATE public.order_follow_ups f SET
    stage = p_stage,
    outcome = btrim(p_outcome),
    follow_up_on = CASE WHEN p_stage = 'closed' THEN NULL ELSE p_follow_up_on END,
    revision = f.revision + 1,
    updated_at = clock_timestamp()
  WHERE f.merchant_id = p_merchant_id AND f.order_id = p_order_id
    AND f.assignee_id = actor AND f.revision = p_revision
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = f.order_id AND o.merchant_id = f.merchant_id)
  RETURNING jsonb_build_object(
    'order_id', f.order_id,
    'merchant_id', f.merchant_id,
    'assignee_id', f.assignee_id,
    'assignee_name', f.assignee_name,
    'stage', f.stage,
    'outcome', f.outcome,
    'follow_up_on', f.follow_up_on,
    'revision', f.revision,
    'updated_at', f.updated_at
  ) INTO result;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.order_follow_ups f
      WHERE f.merchant_id = p_merchant_id AND f.order_id = p_order_id AND f.assignee_id = actor
    ) THEN
      -- PT409 reaches the app as HTTP 409. Not 40001: PostgREST treats that as a
      -- transient failure and retries the whole transaction.
      RAISE EXCEPTION 'Follow-up changed' USING ERRCODE = 'PT409';
    END IF;
    RAISE EXCEPTION 'Follow-up unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
