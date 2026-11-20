CREATE FUNCTION public.can_write_order_follow_ups(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT public.check_staff_permission(actor, p_merchant_id, 'customers', 'view')
     AND public.check_staff_permission(actor, p_merchant_id, 'customers', 'edit')
  FROM (SELECT auth.uid() AS actor) AS caller;
$$;

REVOKE ALL ON FUNCTION public.can_write_order_follow_ups(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_order_follow_ups(uuid) TO authenticated;

-- Disallow address-like text in the label, including addresses embedded in
-- display names or truncated at the label's length limit.
ALTER FUNCTION private.clear_unassigned_order_follow_up_name()
  RENAME TO normalize_order_follow_up_name;

CREATE OR REPLACE FUNCTION private.normalize_order_follow_up_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.assignee_name := CASE WHEN NEW.assignee_id IS NULL
    THEN 'Unassigned'
    ELSE 'Team member'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER clear_unassigned_order_follow_up_name ON public.order_follow_ups;
CREATE TRIGGER normalize_order_follow_up_name
  BEFORE INSERT OR UPDATE OF assignee_id, assignee_name
  ON public.order_follow_ups
  FOR EACH ROW
  WHEN (
    (NEW.assignee_id IS NULL AND NEW.assignee_name IS DISTINCT FROM 'Unassigned')
    OR strpos(NEW.assignee_name, '@') > 0
  )
  EXECUTE FUNCTION private.normalize_order_follow_up_name();

UPDATE public.order_follow_ups
SET assignee_name = 'Team member', revision = revision + 1, updated_at = clock_timestamp()
WHERE assignee_id IS NOT NULL AND strpos(assignee_name, '@') > 0;

NOTIFY pgrst, 'reload schema';
