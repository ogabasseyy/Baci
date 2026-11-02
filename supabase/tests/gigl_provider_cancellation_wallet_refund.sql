-- REGRESSION TEST: a GIG-reported cancellation (MSCC/MSCP/SSC, normalized
-- 'cancelled') of a merchant-wallet-funded GIGL booking failed forever with
-- 55P03 'active_merchant_shipping_charge' and never refunded the wallet
-- (production: charge 6d195a34, waybill 1349639673, 48,500.40). Migrations
-- 20261102053300 (waybill stamp), 20261102053310 (refund helper) and
-- 20261102053320 (apply patch) refund the booked charge exactly once from the
-- trusted tracking apply path, only for a waybill the server's own
-- complete() stamped, only for cancellations before pickup that GIG's own
-- recorded timeline backs and that the tracking worker attested
-- (GIG's preshipment record for the waybill names Baci's own GIG account),
-- and leave private.prevent_active_gigl_shipping_cancellation unchanged.
--
-- Without those migrations T1 fails with ERROR active_merchant_shipping_charge
-- (SQLSTATE 55P03) raised from the apply call.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/gigl_provider_cancellation_wallet_refund.sql
--
-- This entry point owns the transaction and loads its parts with \ir so each
-- file stays under 300 lines:
--   _fixtures.inc.sql     merchant, owner, orders.edit staff, wallet, orders
--   _events.inc.sql       GIG event builders, attestation, apply entry point
--   _refund.inc.sql       T1 refund, T2 idempotency, T3 backstop, T7 no
--                         charge, T8 waybill stamp
--   _blocked.inc.sql      T4 other cancellation writers, T5 waybill swap,
--                         T6 needs_reconciliation, T10 cancelled after pickup
--   _evidence.inc.sql     T11 pickup and cancel in one poll, T12 status moved
--                         back by the merchant, T13 another order's
--                         Baci-booked waybill bound via recover, T14 one
--                         waybill per charge, T15 no creation scan in the
--                         submission window, T16 earlier history
--   _attestation.inc.sql  T17 fresh decoy waybill from the merchant's own GIG
--                         account, T18 attestation forms that do not count,
--                         T19 cancellation before creation, T20 debit
--                         mismatch, T21 missing wallet, T22 server row
--                         rewritten before complete, T23 unmapped
--                         post-pickup scan stored as 'pending'
--   _catalog.inc.sql      T9 privileges, triggers, indexes and patched apply

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

\ir gigl_provider_cancellation_wallet_refund_fixtures.inc.sql
\ir gigl_provider_cancellation_wallet_refund_events.inc.sql
\ir gigl_provider_cancellation_wallet_refund_refund.inc.sql
\ir gigl_provider_cancellation_wallet_refund_blocked.inc.sql
\ir gigl_provider_cancellation_wallet_refund_evidence.inc.sql
\ir gigl_provider_cancellation_wallet_refund_attestation.inc.sql
\ir gigl_provider_cancellation_wallet_refund_catalog.inc.sql

ROLLBACK;
