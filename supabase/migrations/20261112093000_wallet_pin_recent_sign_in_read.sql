-- Wallet PIN: let the app know BEFORE the customer types a new PIN whether
-- setting or resetting it would be refused for an old sign-in.
--
-- set_wallet_pin and reset_wallet_pin refuse with reauthentication_required
-- unless wallet_pin_private.has_recent_authentication() is true (a primary
-- sign-in within the last 15 minutes on a live session, AAL2 when the user
-- has a verified MFA factor). This read returns that exact answer for the
-- caller's own session and nothing else, so the storefront can ask the
-- customer to confirm it's them first instead of failing after two PIN
-- entries.
--
-- Read-only: it changes no rule, no window and no state. The 15-minute window
-- stays as it is (step-up guidance is 15 to 60 minutes; short is right for
-- money). The answer is only a hint: set and reset still check it themselves.

BEGIN;

CREATE FUNCTION public.has_recent_wallet_pin_sign_in()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT wallet_pin_private.has_recent_authentication();
$$;

COMMENT ON FUNCTION public.has_recent_wallet_pin_sign_in() IS
  'True when the caller''s session would pass the wallet PIN set/reset sign-in-age check. Read-only hint; set_wallet_pin and reset_wallet_pin enforce it.';

REVOKE ALL ON FUNCTION public.has_recent_wallet_pin_sign_in()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_recent_wallet_pin_sign_in() TO authenticated;

COMMIT;
