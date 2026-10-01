-- Validate the discovery metadata object constraint outside the migration
-- that added it: validation scans the populated products table, and running
-- it in the same transaction would retain the ALTER TABLE lock against
-- catalog writes for the duration of the scan. VALIDATE CONSTRAINT takes a
-- SHARE UPDATE EXCLUSIVE lock that permits concurrent reads and writes.
ALTER TABLE public.products VALIDATE CONSTRAINT products_discovery_metadata_object;
