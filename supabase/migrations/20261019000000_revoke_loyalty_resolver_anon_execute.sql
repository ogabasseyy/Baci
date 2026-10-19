-- Issue #3696 (HIGH): get_loyalty_redemption_for_checkout is a
-- read-only enumeration oracle. It returns reward_value, minimum,
-- expiry, and used status for any guessed RDM-* code of a known
-- merchant_id, and RDM codes are bearer-spendable at guest checkout.
-- The Next.js validate route relies on proxy.ts rate limiting, but an
-- anon caller could invoke this SECURITY DEFINER RPC directly through
-- PostgREST, bypassing the Next proxy entirely.
--
-- Revoke anon AND authenticated EXECUTE. Authenticated is no trust
-- boundary here (self-registration is open), so it is the same
-- enumeration oracle. Both server-side callers now resolve through
-- the service-role client behind the rate-limited routes:
-- POST /api/storefront/discount/validate and the orders checkout path
-- (resolveLoyaltyCheckoutCode).
--
-- Deliberately NOT touched: create_storefront_order_with_loyalty_code
-- stays anon-granted by design (guest checkout needs it; the wrapper
-- is self-policing with atomic claim + exact amount checks). The
-- merchant-code resolver get_storefront_discount_code has the same
-- shape and stays as-is (out of scope for #3696).

REVOKE EXECUTE ON FUNCTION public.get_loyalty_redemption_for_checkout(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_loyalty_redemption_for_checkout(uuid, text) FROM authenticated;
