-- REGRESSION TEST: a GIG-reported cancellation (MSCC/MSCP/SSC, normalized
-- 'cancelled') of a merchant-wallet-funded GIGL booking failed forever with
-- 55P03 'active_merchant_shipping_charge' and never refunded the wallet
-- (production: charge 6d195a34, waybill 1349639673, 48,500.40). Migration
-- 20261102053300 refunds the booked charge exactly once from the trusted
-- tracking apply path, only for cancellations before pickup that GIG's own
-- recorded timeline backs, and leaves
-- private.prevent_active_gigl_shipping_cancellation unchanged.
--
-- Without that migration T1 fails with ERROR active_merchant_shipping_charge
-- (SQLSTATE 55P03) raised from the apply call.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/gigl_provider_cancellation_wallet_refund.sql
--
-- This entry point owns the transaction and loads its parts with \ir so each
-- file stays under 300 lines:
--   _fixtures.inc.sql  merchant, owner, orders.edit staff, wallet, helpers
--   _refund.inc.sql    T1 refund, T2 idempotency, T3 backstop, T7 no charge,
--                      T8 waybill stamp
--   _blocked.inc.sql   T4 other cancellation writers, T5 waybill swap,
--                      T6 needs_reconciliation, T10 cancelled after pickup
--   _evidence.inc.sql  T11 pickup and cancel in one poll, T12 status moved
--                      back by the merchant, T13 decoy waybill bound via
--                      recover, T14 one waybill per charge, T15 no creation
--                      scan in the submission window, T16 earlier history
--   _catalog.inc.sql   T9 privileges, triggers, indexes and patched apply text

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

\ir gigl_provider_cancellation_wallet_refund_fixtures.inc.sql
\ir gigl_provider_cancellation_wallet_refund_refund.inc.sql
\ir gigl_provider_cancellation_wallet_refund_blocked.inc.sql
\ir gigl_provider_cancellation_wallet_refund_evidence.inc.sql
\ir gigl_provider_cancellation_wallet_refund_catalog.inc.sql

ROLLBACK;
