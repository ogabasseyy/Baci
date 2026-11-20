-- Staff workflow is independent of lender and order payment status.
CREATE TABLE IF NOT EXISTS public.order_follow_ups (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_name text NOT NULL CHECK (char_length(assignee_name) BETWEEN 1 AND 160),
  stage text NOT NULL DEFAULT 'needs_follow_up'
    CHECK (stage IN ('needs_follow_up', 'contacted', 'waiting', 'closed')),
  outcome text NOT NULL DEFAULT '' CHECK (char_length(outcome) <= 1000),
  follow_up_on date CHECK (follow_up_on BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'closed' OR follow_up_on IS NULL)
);

CREATE INDEX IF NOT EXISTS order_follow_ups_merchant_idx ON public.order_follow_ups (merchant_id, order_id);
CREATE INDEX IF NOT EXISTS order_follow_ups_assignee_idx ON public.order_follow_ups (assignee_id);

ALTER TABLE public.order_follow_ups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_follow_ups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_follow_ups TO authenticated;
DROP POLICY IF EXISTS order_follow_ups_read ON public.order_follow_ups;
CREATE POLICY order_follow_ups_read ON public.order_follow_ups
  FOR SELECT TO authenticated USING (public.has_merchant_access(merchant_id));

CREATE OR REPLACE FUNCTION public.claim_order_follow_up(p_merchant_id uuid, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  display_name text;
  claimed_by uuid;
  result jsonb;
BEGIN
  IF actor IS NULL OR public.has_merchant_access(p_merchant_id) IS NOT TRUE OR NOT EXISTS (
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
  WHERE f.merchant_id = p_merchant_id AND f.assignee_id IS NULL;

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
  IF actor IS NULL OR public.has_merchant_access(p_merchant_id) IS NOT TRUE THEN
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

REVOKE ALL ON FUNCTION public.claim_order_follow_up(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_order_follow_up(uuid, uuid, integer, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_order_follow_up(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_follow_up(uuid, uuid, integer, text, text, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
