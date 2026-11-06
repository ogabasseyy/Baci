-- Revision state is internal and is read only by narrowly scoped database
-- functions. Keep direct access denied even if a grant is accidentally added.
DROP POLICY IF EXISTS merchant_shipping_config_revisions_deny_direct_access
  ON public.merchant_shipping_config_revisions;

CREATE POLICY merchant_shipping_config_revisions_deny_direct_access
  ON public.merchant_shipping_config_revisions
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY merchant_shipping_config_revisions_deny_direct_access
  ON public.merchant_shipping_config_revisions IS
  'Revision state is internal; direct access including service_role is intentionally revoked. Use narrowly scoped SECURITY DEFINER functions.';
