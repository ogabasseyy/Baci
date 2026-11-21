-- Preserve the existing customer permissions and terminal follow-up state.
DROP POLICY IF EXISTS order_follow_ups_read ON public.order_follow_ups;
CREATE POLICY order_follow_ups_read ON public.order_follow_ups FOR SELECT TO authenticated
USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'view'));

CREATE OR REPLACE FUNCTION private.can_edit_order_follow_up(p_actor uuid, p_merchant uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.staff_members s
  WHERE s.merchant_id = p_merchant AND s.user_id = p_actor AND s.status = 'active'
  ORDER BY s.id
  FOR SHARE;

  RETURN public.check_staff_permission(p_actor, p_merchant, 'customers', 'view')
     AND public.check_staff_permission(p_actor, p_merchant, 'customers', 'edit');
END;
$$;

-- The canonical permission RPC checks the current caller. Offboarding and
-- permission changes must instead evaluate the assignee, including migrations
-- without an authenticated request. Match its wildcard and custom precedence.
CREATE OR REPLACE FUNCTION private.order_follow_up_customer_permission(
  custom_permissions jsonb, role_defaults jsonb, p_action text
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(
    (grants.wildcard->>'*')::boolean,
    (grants.wildcard->>p_action)::boolean,
    (grants.customers->>'*')::boolean,
    (grants.customers->>p_action)::boolean,
    (grants.customers->>'all')::boolean,
    (grants.full_access->>'all')::boolean,
    false
  )
  FROM (
    SELECT
      COALESCE(role_defaults->'*', '{}'::jsonb) || COALESCE(custom_permissions->'*', '{}'::jsonb) AS wildcard,
      COALESCE(role_defaults->'customers', '{}'::jsonb) || COALESCE(custom_permissions->'customers', '{}'::jsonb) AS customers,
      COALESCE(role_defaults->'full_access', '{}'::jsonb) || COALESCE(custom_permissions->'full_access', '{}'::jsonb) AS full_access
  ) grants;
$$;
REVOKE ALL ON FUNCTION private.order_follow_up_customer_permission(jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.order_follow_up_assignee_eligible(p_merchant uuid, p_assignee uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant AND m.user_id = p_assignee
  ) OR EXISTS (
    SELECT 1 FROM public.staff_members s
    LEFT JOIN public.role_permissions rp ON rp.role = s.role
    WHERE s.merchant_id = p_merchant AND s.user_id = p_assignee AND s.status = 'active'
      AND private.order_follow_up_customer_permission(s.permissions, rp.permissions, 'view')
      AND private.order_follow_up_customer_permission(s.permissions, rp.permissions, 'edit')
  );
$$;
REVOKE ALL ON FUNCTION private.order_follow_up_assignee_eligible(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.release_removed_staff_follow_ups()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'active' AND OLD.user_id IS NOT NULL THEN
    UPDATE public.order_follow_ups AS f
    SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
    WHERE f.merchant_id = OLD.merchant_id AND f.assignee_id = OLD.user_id
      AND f.stage <> 'closed'
      AND NOT private.order_follow_up_assignee_eligible(f.merchant_id, f.assignee_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS release_removed_staff_follow_ups ON public.staff_members;
CREATE TRIGGER release_removed_staff_follow_ups
AFTER UPDATE OF status, user_id, merchant_id, role, permissions OR DELETE ON public.staff_members
FOR EACH ROW EXECUTE FUNCTION private.release_removed_staff_follow_ups();

UPDATE public.order_follow_ups AS f
SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
WHERE f.assignee_id IS NOT NULL AND f.stage <> 'closed'
  AND NOT private.order_follow_up_assignee_eligible(f.merchant_id, f.assignee_id);

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
  WHERE f.merchant_id = p_merchant_id AND f.order_id = p_order_id;
  IF result->>'stage' = 'closed' THEN
    RAISE EXCEPTION 'Follow-up already closed' USING ERRCODE = 'PT410';
  END IF;
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
    AND f.assignee_id = actor AND f.revision = p_revision AND f.stage <> 'closed'
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
      JOIN public.orders o ON o.id = f.order_id AND o.merchant_id = f.merchant_id
      WHERE f.merchant_id = p_merchant_id AND f.order_id = p_order_id
        AND f.assignee_id = actor AND f.stage = 'closed'
    ) THEN
      RAISE EXCEPTION 'Follow-up already closed' USING ERRCODE = 'PT410';
    END IF;
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
