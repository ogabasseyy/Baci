-- ================================================================
-- REGRESSION TEST: bounded public merchant/PDP read snapshots
--
-- This runner keeps one transactional fixture while focused SQL files own
-- contracts, merchant setup, catalog setup, linked-blog setup, and assertions.
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_public_read_snapshots.sql
-- ================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

\ir storefront_public_read_snapshots/001_contract.sql
\ir storefront_public_read_snapshots/002_merchant_fixture.sql
\ir storefront_public_read_snapshots/003_catalog_fixture.sql
\ir storefront_public_read_snapshots/004_product_fixture.sql
\ir storefront_public_read_snapshots/005_linked_blog_fixture.sql

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

\ir storefront_public_read_snapshots/006_merchant_assertions.sql
\ir storefront_public_read_snapshots/007_pdp_assertions.sql
\ir storefront_public_read_snapshots/008_semantic_enrichment_assertions.sql
\ir storefront_public_read_snapshots/009_semantic_read_indexes.sql

ROLLBACK;
