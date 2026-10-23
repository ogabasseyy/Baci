CREATE OR REPLACE FUNCTION public.get_jumia_product_export_selection_page_for_merchant(
  p_selection_id uuid,
  p_merchant_id uuid,
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_selection_merchant_id uuid;
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR p_selection_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Jumia selection page request'
      USING ERRCODE = '22023';
  END IF;

  SELECT selection.merchant_id
  INTO v_selection_merchant_id
  FROM public.jumia_product_export_selections AS selection
  WHERE selection.id = p_selection_id;

  IF NOT FOUND
    OR v_selection_merchant_id IS DISTINCT FROM p_merchant_id
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Jumia selection not found'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.get_jumia_product_export_selection_page(
    p_selection_id, p_page, p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_jumia_product_export_selection_page_for_merchant(
  uuid, uuid, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_jumia_product_export_selection_page_for_merchant(
  uuid, uuid, integer, integer
) TO authenticated;

COMMENT ON FUNCTION public.get_jumia_product_export_selection_page_for_merchant(
  uuid, uuid, integer, integer
) IS 'Binds a page request to the merchant selected by the client before delegating authorization, entitlement, expiry, and page validation to the canonical selection page RPC.';

NOTIFY pgrst, 'reload schema';
