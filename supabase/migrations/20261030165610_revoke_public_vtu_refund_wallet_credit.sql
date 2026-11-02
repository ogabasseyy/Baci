BEGIN;

-- refund_customer_wallet_for_vtu is a SECURITY DEFINER wallet writer whose
-- only check is that the customer belongs to the merchant, so it must stay
-- service-role-only (every legitimate caller is a service-role VTU route,
-- plus the SECURITY DEFINER reverse_vtu_wallet_payment, owned by postgres).
--
-- 20260612054548 revoked anon/authenticated EXECUTE explicitly. Then
-- 20261016010000 dropped and re-created the function with a new
-- p_expected_status argument but revoked only PUBLIC. Supabase default
-- privileges grant EXECUTE on new public functions directly to anon and
-- authenticated, and REVOKE ... FROM PUBLIC does not remove those direct
-- grants, so the re-created function was executable with the anon key.
--
-- Revoke the default grants explicitly and keep service_role. Production
-- was already corrected directly with these exact statements; both are
-- idempotent, so re-running them on deploy is a no-op there.
REVOKE ALL ON FUNCTION public.refund_customer_wallet_for_vtu(
  uuid, uuid, numeric, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_customer_wallet_for_vtu(
  uuid, uuid, numeric, uuid, text, text
) TO service_role;

COMMIT;
