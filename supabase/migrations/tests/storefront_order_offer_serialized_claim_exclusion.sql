-- =============================================
-- REGRESSION TEST (issue #3734): serialized-claim exclusion must match
-- the persisted line identity.
--   An offer_id-only line (no client condition) stages t.condition from
--   the product fallback while t.offer_condition carries the offer's
--   live condition; the persisted oi.condition is the COALESCE of both.
--   The serialized-unit claim loop must exclude that line, otherwise it
--   reserves base-product units after the offer stock decrement.
--   NOTE: a condition-only line (condition without offer_id) is not a
--   valid shape on a serialized product: condition_valid requires a
--   quantity-managed pool, and serialized policies are never managed.
--   The fixture therefore covers the supported offer shapes only:
--   two offer_id-only units of one offer (A/B), a same-product plain
--   line colliding with the product fallback condition (C), a second
--   offer's unit (D), and a plain control line on another product (E).
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_serialized_claim_exclusion.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

\ir storefront_order_offer_serialized_claim_creation.inc.sql
\ir storefront_order_offer_serialized_claim_reuse.inc.sql
\ir storefront_order_offer_serialized_claim_confirmation.inc.sql

ROLLBACK;
