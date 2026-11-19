-- MANUAL RELEASE CUTOVER, deliberately outside automatic migrations.
-- Requires separate production approval and a verified web/mobile-admin release.
-- Old mobile-admin clients that still select products.cost_price WILL FAIL.
-- Do not run until the rollout owner accepts that compatibility boundary.
-- Read docs/security/product-cost-access-rollout.md first.
--
-- In the same SQL session, after those checks and approval:
-- SET baci.product_cost_access_cutover = 'web-and-mobile-admin-verified';
-- Then run this file. This marker is an operator acknowledgement, not auth.
\set ON_ERROR_STOP on
BEGIN;
\ir revoke-products-cost-price.inc.sql
COMMIT;
