-- Wallet setup asks a shopper for their own phone number and their first and
-- last name before it creates their PiggyVest wallet. These two RPCs save
-- exactly those fields on the caller's own customer row for one merchant:
--
--   set_customer_wallet_phone(merchant, expected user, phone)
--   set_customer_wallet_profile(merchant, expected user, first name, last name)
--
-- Both were first proposed in #3808 (20261017084453 and 20261022090000) and
-- are re-authored here with a new timestamp. Those drafts must never be
-- applied after this file: they would replace both functions with weaker
-- versions. Both SQL suites check the final shape through the catalog.
-- Changes from those drafts:
--
-- * SECURITY DEFINER with an empty search_path (every name is qualified), so
--   the RPC can check onboarding intents, which shoppers cannot read.
-- * Once the caller has any onboarding intent for that merchant, these RPCs
--   refuse to change the details (55000 wallet_profile_locked). Saving the
--   values already stored is accepted and writes nothing, so a retried setup
--   step does not fail. "Not started" means no intent row exists; every
--   stored state (dispatched, unknown, routing_pending, accepted, verified,
--   and rejected with or without a review reason) is past it, and an intent
--   detached from a deleted customer row still counts for the same user.
--   Onboarding fingerprints the name and phone it sends, and the provider
--   returns an existing customer by phone and keeps the details it was first
--   given, so wallet setup must not change them once onboarding has begun.
-- * The lock covers these two RPCs only. Other profile paths (the storefront
--   account screens and the merchant dashboard) still write the same columns
--   under the existing table policies. Whether they must also stop once
--   onboarding has begun is decided before any client is enabled.
-- * The customer row is locked before the intent check, and an onboarding
--   claim locks the same row, so a save and a claim's own statements run one
--   after the other: a save that waits behind a claim then sees its intent.
--   The onboarding request reads the name and phone before it claims, so a
--   save that commits between that read and the claim is not seen by that
--   request. Re-checking the details after the claim belongs to onboarding.
-- * The phone is stored in one canonical form, the PiggyVest one: digits
--   only, with 234 in place of a leading 0. The rules are those of
--   public.normalize_repair_pickup_phone_digits, the SQL twin of the shared
--   normalizePhoneToE164. A number already held by another customer of the
--   merchant, in any stored format and including deleted rows (as the unique
--   phone index does), is refused with a stable error (23505
--   wallet_phone_unavailable) and no database detail.
-- * Names are saved only on individual customers: the full-name trigger
--   clears first and last names on company customers, so a save would
--   silently do nothing (55000 wallet_profile_individual_only).
-- * The result lists its columns explicitly (the storefront customer shape).
--
-- Other refusals: a missing session or a mismatched expected user, and a
-- merchant where the caller has no live customer row (including a deleted
-- one), are 42501; malformed input is 22023. No table policy changes.
--
-- Only signed-in shoppers may call them: EXECUTE is revoked from PUBLIC,
-- anon, authenticated and service_role, then granted to authenticated. No
-- client calls them yet.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_customer_wallet_phone(
  p_merchant_id uuid,
  p_expected_user_id uuid,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_phone text := pg_catalog.btrim(p_phone);
  v_customer_id uuid;
  v_stored_phone text;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'customer_identity_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^\+?[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'invalid_wallet_phone' USING ERRCODE = '22023';
  END IF;
  v_phone := public.normalize_repair_pickup_phone_digits(v_phone);
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'invalid_wallet_phone' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.phone INTO v_customer_id, v_stored_phone
  FROM public.customers c
  WHERE c.merchant_id = p_merchant_id
    AND c.user_id = v_user_id
    AND c.deleted_at IS NULL
  FOR NO KEY UPDATE;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_profile_unavailable' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM piggyvest_primary.onboarding_intents i
    WHERE i.merchant_id = p_merchant_id
      AND (i.customer_id = v_customer_id OR i.user_id = v_user_id)
  ) THEN
    -- The same number in any format changes nothing, so it is not refused
    -- and the stored text (which onboarding fingerprinted) is kept.
    IF public.normalize_repair_pickup_phone_digits(v_stored_phone)
      IS DISTINCT FROM v_phone THEN
      RAISE EXCEPTION 'wallet_profile_locked' USING ERRCODE = '55000';
    END IF;
  ELSIF v_stored_phone IS DISTINCT FROM v_phone THEN
    IF EXISTS (
      SELECT 1
      FROM public.customers o
      WHERE o.merchant_id = p_merchant_id
        AND o.id <> v_customer_id
        AND o.phone IS NOT NULL
        AND o.phone <> ''
        AND public.normalize_repair_pickup_phone_digits(o.phone) = v_phone
    ) THEN
      RAISE EXCEPTION 'wallet_phone_unavailable' USING ERRCODE = '23505';
    END IF;
    BEGIN
      UPDATE public.customers c
      SET phone = v_phone
      WHERE c.id = v_customer_id
        AND c.merchant_id = p_merchant_id
        AND c.user_id = v_user_id
        AND c.deleted_at IS NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'wallet_phone_unavailable' USING ERRCODE = '23505';
    END;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'email', c.email,
    'first_name', c.first_name,
    'last_name', c.last_name,
    'phone', c.phone,
    'loyalty_points', c.loyalty_points,
    'username', c.username,
    'username_changed_at', c.username_changed_at,
    'date_of_birth', c.date_of_birth
  ) INTO v_result
  FROM public.customers c
  WHERE c.id = v_customer_id
    AND c.merchant_id = p_merchant_id
    AND c.user_id = v_user_id
    AND c.deleted_at IS NULL;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'customer_profile_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_customer_wallet_phone(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_customer_wallet_phone(uuid, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_customer_wallet_profile(
  p_merchant_id uuid,
  p_expected_user_id uuid,
  p_first_name text,
  p_last_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_first_name text := pg_catalog.btrim(p_first_name);
  v_last_name text := pg_catalog.btrim(p_last_name);
  v_customer_id uuid;
  v_customer_type text;
  v_unchanged boolean;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'customer_identity_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL
    OR pg_catalog.length(v_first_name) NOT BETWEEN 1 AND 100
    OR pg_catalog.length(v_last_name) NOT BETWEEN 1 AND 100
    OR pg_catalog.length(v_first_name) + 1 + pg_catalog.length(v_last_name) > 200
    OR v_first_name ~ '[[:cntrl:]]'
    OR v_last_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_wallet_names' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.customer_type,
    c.first_name IS NOT DISTINCT FROM v_first_name
      AND c.last_name IS NOT DISTINCT FROM v_last_name
  INTO v_customer_id, v_customer_type, v_unchanged
  FROM public.customers c
  WHERE c.merchant_id = p_merchant_id
    AND c.user_id = v_user_id
    AND c.deleted_at IS NULL
  FOR NO KEY UPDATE;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_profile_unavailable' USING ERRCODE = '42501';
  END IF;

  -- The names already stored change nothing, so they are not refused.
  IF NOT v_unchanged AND EXISTS (
    SELECT 1
    FROM piggyvest_primary.onboarding_intents i
    WHERE i.merchant_id = p_merchant_id
      AND (i.customer_id = v_customer_id OR i.user_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'wallet_profile_locked' USING ERRCODE = '55000';
  END IF;
  IF v_customer_type IS DISTINCT FROM 'individual' THEN
    RAISE EXCEPTION 'wallet_profile_individual_only' USING ERRCODE = '55000';
  END IF;

  IF NOT v_unchanged THEN
    UPDATE public.customers c
    SET first_name = v_first_name,
        last_name = v_last_name
    WHERE c.id = v_customer_id
      AND c.merchant_id = p_merchant_id
      AND c.user_id = v_user_id
      AND c.deleted_at IS NULL;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'email', c.email,
    'first_name', c.first_name,
    'last_name', c.last_name,
    'phone', c.phone,
    'loyalty_points', c.loyalty_points,
    'username', c.username,
    'username_changed_at', c.username_changed_at,
    'date_of_birth', c.date_of_birth
  ) INTO v_result
  FROM public.customers c
  WHERE c.id = v_customer_id
    AND c.merchant_id = p_merchant_id
    AND c.user_id = v_user_id
    AND c.deleted_at IS NULL;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'customer_profile_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_customer_wallet_profile(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_customer_wallet_profile(uuid, uuid, text, text)
  TO authenticated;

COMMIT;
