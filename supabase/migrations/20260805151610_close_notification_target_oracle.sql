-- Explicit targeting is directory access; notification management alone may
-- not validate or enumerate merchant identities.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_admin_notification_target_merchant_ids_v1(
  p_merchant_ids uuid[]
)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' AND (
    (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
      (SELECT auth.uid()), 'merchants.read'
    ) OR NOT private.has_platform_admin_permission_v1(
      (SELECT auth.uid()), 'notifications.manage'
    )
  ) THEN RAISE EXCEPTION 'Merchant directory access required' USING ERRCODE = '42501'; END IF;
  IF COALESCE(cardinality(p_merchant_ids), 0) > 500 THEN
    RAISE EXCEPTION 'Too many notification targets' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::uuid[]) INTO v_ids
  FROM public.merchants AS m WHERE m.id = ANY(COALESCE(p_merchant_ids, '{}'::uuid[]));
  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_admin_notification_target_merchant_ids_v1(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_admin_notification_target_merchant_ids_v1(uuid[])
  TO authenticated, service_role;

COMMIT;
