-- Follow-up readers do not inherit the staff directory's email permissions.
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
    (SELECT nullif(btrim(s.name), '')
     FROM public.staff_members s
     WHERE s.merchant_id = p_merchant_id AND s.user_id = actor AND s.status = 'active'
     ORDER BY s.id LIMIT 1),
    (SELECT nullif(btrim(u.raw_user_meta_data->>'full_name'), '')
     FROM auth.users u WHERE u.id = actor),
    'Team member'
  ) INTO display_name;
  IF display_name ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    display_name := 'Team member';
  END IF;

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

UPDATE public.order_follow_ups
SET assignee_name = 'Team member', revision = revision + 1, updated_at = clock_timestamp()
WHERE assignee_name ~ '^[^[:space:]@]+@[^[:space:]@]+$';

NOTIFY pgrst, 'reload schema';
