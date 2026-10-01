-- Preserve owner-scoped cleanup for create-only receipt uploads.

DROP POLICY IF EXISTS expense_receipts_delete ON storage.objects;
CREATE POLICY expense_receipts_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[2] = 'expenses'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
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
