-- Keep delete authorization scoped to the expense receipt namespace.
DROP POLICY IF EXISTS expense_receipts_delete ON storage.objects;

CREATE POLICY expense_receipts_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[2] = 'expenses'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND NOT private.expense_receipt_is_referenced(name)
    AND (
      public.check_staff_permission(
        (SELECT auth.uid()),
        ((storage.foldername(name))[1])::uuid,
        'expenses',
        'edit'
      )
      OR (
        public.check_staff_permission(
          (SELECT auth.uid()),
          ((storage.foldername(name))[1])::uuid,
          'expenses',
          'create'
        )
        AND owner_id = (SELECT auth.uid())::text
      )
    )
  );
