COMMENT ON POLICY merchant_shipping_config_revisions_deny_direct_access
  ON public.merchant_shipping_config_revisions IS
  'This RLS policy denies direct access for roles subject to row-level security. service_role bypasses RLS; its direct access is blocked by the table ACL revocation. Use narrowly scoped SECURITY DEFINER functions.';
