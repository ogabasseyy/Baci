-- Simple Jumia product mappings use variant_id = NULL. PostgreSQL treats NULLs as
-- distinct in the default unique constraint, so republishing the same simple product
-- inserted duplicate mappings instead of updating the existing row.
--
-- Step 1: collapse any existing duplicates deterministically. Keep the legacy
-- unique constraint in place until the concurrent replacement index is attached.

DELETE FROM public.jumia_product_mappings AS duplicate
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY product_id, variant_id, jumia_shop_id
        ORDER BY
          -- A newer pending/error duplicate must never displace the row
          -- that holds the live remote identity; deleting the synced row
          -- would orphan stock sync and let a retry duplicate the listing.
          (jumia_product_id IS NOT NULL) DESC,
          (sync_status = 'synced') DESC,
          (sync_status = 'pending') DESC,
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST,
          id DESC
      ) AS row_number
    FROM public.jumia_product_mappings
  ) ranked
  WHERE ranked.row_number > 1
) doomed
WHERE duplicate.id = doomed.id;
