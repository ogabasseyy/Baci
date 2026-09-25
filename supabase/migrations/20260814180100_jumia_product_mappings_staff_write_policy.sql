-- Allow integrations managers to reconcile Jumia product mappings.

DROP POLICY IF EXISTS jumia_product_mappings_merchant_policy
  ON public.jumia_product_mappings;

CREATE POLICY jumia_product_mappings_merchant_policy
ON public.jumia_product_mappings
USING (
  merchant_id IN (
    SELECT merchant.id
    FROM public.merchants AS merchant
    WHERE merchant.user_id = (SELECT auth.uid())
    UNION
    SELECT staff_members.merchant_id
    FROM public.staff_members AS staff_members
    WHERE staff_members.user_id = (SELECT auth.uid())
      AND staff_members.status = 'active'
  )
)
WITH CHECK (
  merchant_id IN (
    SELECT merchant.id
    FROM public.merchants AS merchant
    WHERE merchant.user_id = (SELECT auth.uid())
  )
  OR public.check_staff_permission(
    (SELECT auth.uid()),
    merchant_id,
    'integrations',
    'manage'
  )
);
