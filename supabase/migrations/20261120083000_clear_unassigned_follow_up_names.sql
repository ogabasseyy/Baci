CREATE FUNCTION private.clear_unassigned_order_follow_up_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.assignee_name := 'Unassigned';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_unassigned_order_follow_up_name()
  FROM PUBLIC, anon, authenticated;

-- Apply to permission and membership changes as well as FK account deletion.
CREATE TRIGGER clear_unassigned_order_follow_up_name
  BEFORE INSERT OR UPDATE OF assignee_id, assignee_name
  ON public.order_follow_ups
  FOR EACH ROW
  WHEN (NEW.assignee_id IS NULL AND NEW.assignee_name IS DISTINCT FROM 'Unassigned')
  EXECUTE FUNCTION private.clear_unassigned_order_follow_up_name();

UPDATE public.order_follow_ups
SET assignee_name = 'Unassigned', revision = revision + 1, updated_at = clock_timestamp()
WHERE assignee_id IS NULL AND assignee_name IS DISTINCT FROM 'Unassigned';
