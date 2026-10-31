-- Store Settings saved truncated contact numbers such as "+23415781" on
-- production (2026-09-05, 09-24 and 10-09). The guarded identity RPC only
-- checked the character set, and couriers receive merchants.phone verbatim as
-- the sender contact. Add a shape check for the phone keys a save sends:
-- saves that leave the phones alone keep working, and stored values are not
-- touched.
--
-- The rule mirrors packages/shared/src/lib/merchant-contact-phone.ts:
--   +234 / 00234 numbers need exactly ten national digits (an optional trunk
--   0 is tolerated because the mobile phone picker keeps it);
--   other international numbers must be E.164 (8-15 digits, no leading 0);
--   national-format numbers carry no country and need 7-15 digits.
-- merchants.phone also follows packages/shared/src/lib/merchant-sender-phone.ts:
-- booking treats it as international only when it starts with + or 00 and
-- reads anything else as Nigerian, so such a number must be a complete
-- Nigerian number (0XXXXXXXXXX, 234[0]XXXXXXXXXX or ten digits).
--
-- Patch the deployed definition in place, as
-- 20260730084051_repair_merchant_identity_guard_paths.sql does, instead of
-- restating the whole function. The implementation is
-- public.update_merchant_identity_settings until the operator-only builder
-- cutover moves it to builder_authorization.guarded_merchant_identity_settings
-- (20261023011500); patch whichever holds it so the cutover wrapper is never
-- replaced. CREATE OR REPLACE keeps the owner, SECURITY DEFINER and grants.
DO $migration$
DECLARE
  v_target pg_catalog.regprocedure := COALESCE(
    pg_catalog.to_regprocedure(
      'builder_authorization.guarded_merchant_identity_settings(uuid,jsonb,timestamptz)'
    ),
    pg_catalog.to_regprocedure(
      'public.update_merchant_identity_settings(uuid,jsonb,timestamptz)'
    )
  );
  v_definition text;
  v_is_security_definer boolean;
  v_marker_count integer;
  v_marker CONSTANT text := '  v_sensitive_change := p_settings ?| ARRAY[';
  v_phone_shape_check CONSTANT text := $check$  -- Couriers receive merchants.phone verbatim: refuse truncated numbers
  -- (20261031120000_require_complete_merchant_contact_phones.sql).
  IF EXISTS (
    SELECT 1
      FROM (VALUES ('phone'), ('support_phone')) AS phone_key(key)
     CROSS JOIN LATERAL (
       SELECT pg_catalog.regexp_replace(
                pg_catalog.btrim(p_settings ->> phone_key.key),
                '[() .-]', '', 'g'
              ) AS compact
     ) AS phone_value
     WHERE p_settings ? phone_key.key
       AND NULLIF(pg_catalog.btrim(p_settings ->> phone_key.key), '') IS NOT NULL
       AND NOT (
         phone_value.compact ~ '^([+]|00)?[0-9]+$'
         AND CASE
           WHEN phone_value.compact ~ '^([+]|00)234'
             THEN phone_value.compact ~ '^([+]|00)2340?[1-9][0-9]{9}$'
           WHEN phone_value.compact ~ '^([+]|00)'
             THEN phone_value.compact ~ '^([+]|00)[1-9][0-9]{7,14}$'
           ELSE phone_value.compact ~ '^[0-9]{7,15}$'
         END
         -- Booking treats the store phone as international only when it
         -- starts with + or 00 and reads anything else as Nigerian.
         AND (
           phone_key.key <> 'phone'
           OR pg_catalog.btrim(p_settings ->> phone_key.key) ~ '^[+]'
           OR phone_value.compact ~ '^00'
           OR pg_catalog.regexp_replace(phone_value.compact, '^[+]', '')
              ~ '^(0[1-9][0-9]{9}|2340?[1-9][0-9]{9}|(?!234)[1-9][0-9]{9})$'
         )
       )
  ) THEN
    RAISE EXCEPTION 'invalid_support_phone' USING ERRCODE = '22023';
  END IF;

$check$;
BEGIN
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'merchant_identity_settings_missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_target), function_row.prosecdef
    INTO v_definition, v_is_security_definer
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = v_target;

  IF v_is_security_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'merchant_identity_settings_security_mode_drift';
  END IF;

  v_marker_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_marker, ''))
  ) / pg_catalog.length(v_marker);
  IF v_marker_count <> 1 THEN
    RAISE EXCEPTION 'merchant_identity_settings_phone_anchor_drift';
  END IF;

  EXECUTE pg_catalog.replace(
    v_definition,
    v_marker,
    v_phone_shape_check || v_marker
  );
END;
$migration$;
