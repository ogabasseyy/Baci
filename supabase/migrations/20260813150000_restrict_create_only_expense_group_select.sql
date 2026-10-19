-- Create-only staff may read active assignable groups, not archived history.
DROP POLICY IF EXISTS expense_group_staff_select ON public.expense_groups;

CREATE POLICY expense_group_staff_select
  ON public.expense_groups
  FOR SELECT
  TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()),
      merchant_id,
      'expenses',
      'view'
    )
    OR (
      public.check_staff_permission(
        (SELECT auth.uid()),
        merchant_id,
        'expenses',
        'create'
      )
      AND archived_at IS NULL
    )
  );
