-- Grant the blog media sweep worker the table privileges its RLS
-- policy gates. The worker migration created the role with usage on
-- public only: PostgreSQL checks privileges before evaluating RLS,
-- so the Storage API's deletes as blog_media_sweep_worker were
-- rejected before the platform-prefix policy could allow them, and
-- claimed bytes were never reclaimed. DELETE plus SELECT on
-- storage.objects (a conditional DELETE reads its WHERE columns) is
-- the core grant; the worker's own RLS policy still confines deletes
-- to media/platform/blog/*. One supporting grant closes the
-- evaluation path: PostgreSQL also applies SELECT policies to a
-- DELETE's row visibility, and the TO PUBLIC storage SELECT policies
-- scan public.merchants, so the worker needs SELECT there to
-- evaluate them (auth.uid() inlines to a setting lookup and needs no
-- schema grant). Its merchants reads stay RLS-gated to zero rows (no
-- merchants SELECT policy matches a uid-less JWT), and the role holds
-- no INSERT, UPDATE, or TRUNCATE anywhere.
GRANT USAGE ON SCHEMA storage TO blog_media_sweep_worker;
GRANT SELECT, DELETE ON storage.objects TO blog_media_sweep_worker;
GRANT SELECT ON public.merchants TO blog_media_sweep_worker;

-- Two pre-existing DELETE policies are TO PUBLIC while filtering on
-- auth.uid()-derived merchant ownership. TO PUBLIC forces every
-- role's DELETE to evaluate them, so the worker's removal fails with
-- "permission denied for table merchants" before its own policy
-- admits the row. Retargeting to authenticated is behavior-preserving:
-- anon callers never matched (auth.uid() is NULL for them),
-- authenticated evaluation is identical, and service_role bypasses
-- RLS either way. USING expressions are verbatim copies.
DROP POLICY IF EXISTS "Merchants can delete migration import files"
  ON storage.objects;
CREATE POLICY "Merchants can delete migration import files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'migration-imports'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT merchants.id::text FROM public.merchants
        WHERE merchants.user_id = auth.uid()
      )
      OR (storage.foldername(name))[1] IN (
        SELECT merchants.id::text FROM public.merchants
        WHERE public.check_staff_permission(auth.uid(), merchants.id, 'settings', 'edit')
           OR public.check_staff_permission(auth.uid(), merchants.id, 'orders',   'edit')
           OR public.check_staff_permission(auth.uid(), merchants.id, 'products', 'create')
      )
    )
  );

DROP POLICY IF EXISTS "owner_delete_kyc_docs" ON storage.objects;
CREATE POLICY "owner_delete_kyc_docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT m.id::text FROM public.merchants m WHERE m.user_id = (SELECT auth.uid())
    )
  );
