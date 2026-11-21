-- A catalog role downgrade must release open claims just like a staff override.
CREATE OR REPLACE FUNCTION private.release_role_follow_ups()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected_roles public.staff_role[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = NEW.role AND OLD.permissions IS NOT DISTINCT FROM NEW.permissions THEN
      RETURN NULL;
    END IF;
    affected_roles := ARRAY[OLD.role, NEW.role];
  ELSE
    affected_roles := ARRAY[OLD.role];
  END IF;

  UPDATE public.order_follow_ups AS f
  SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
  WHERE f.stage <> 'closed'
    AND EXISTS (
      SELECT 1 FROM public.staff_members s
      WHERE s.merchant_id = f.merchant_id AND s.user_id = f.assignee_id
        AND s.status = 'active' AND s.role = ANY (affected_roles)
    )
    AND NOT private.order_follow_up_assignee_eligible(f.merchant_id, f.assignee_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.release_role_follow_ups() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS release_role_follow_ups ON public.role_permissions;
CREATE TRIGGER release_role_follow_ups
AFTER UPDATE OF role, permissions OR DELETE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION private.release_role_follow_ups();

CREATE OR REPLACE FUNCTION private.can_edit_order_follow_up(p_actor uuid, p_merchant uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor_role public.staff_role;
BEGIN
  SELECT s.role INTO actor_role FROM public.staff_members s
  WHERE s.merchant_id = p_merchant AND s.user_id = p_actor AND s.status = 'active'
  FOR SHARE;

  -- Serialize the claim/update with a downgrade or deletion of its role grants.
  PERFORM 1 FROM public.role_permissions rp WHERE rp.role = actor_role FOR SHARE;

  RETURN public.check_staff_permission(p_actor, p_merchant, 'customers', 'view')
     AND public.check_staff_permission(p_actor, p_merchant, 'customers', 'edit');
END;
$$;

-- Recover assignments stranded by a role change before this trigger existed.
UPDATE public.order_follow_ups AS f
SET assignee_id = NULL, revision = f.revision + 1, updated_at = clock_timestamp()
WHERE f.assignee_id IS NOT NULL AND f.stage <> 'closed'
  AND NOT private.order_follow_up_assignee_eligible(f.merchant_id, f.assignee_id);
