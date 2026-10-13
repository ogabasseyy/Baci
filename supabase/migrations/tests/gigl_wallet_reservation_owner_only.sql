-- REGRESSION TEST: new wallet-funded GIGL reservations require the merchant
-- owner, while staff may still resume an existing reserved charge.
-- Run against a database after the ordered migration replay:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/tests/gigl_wallet_reservation_owner_only.sql

BEGIN;

SELECT plan(5);

WITH function_def AS (
  SELECT pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  ) AS definition
)
SELECT ok(
  strpos(definition, 'merchant.user_id = (SELECT auth.uid())') > 0
    AND strpos(definition, 'wallet_reservation_owner_required') > 0,
  'new reservations require the authenticated merchant owner'
)
FROM function_def;

WITH function_def AS (
  SELECT pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  ) AS definition
), positions AS (
  SELECT
    strpos(definition, 'merchant-shipping-order:') AS lock_position,
    strpos(definition, 'SELECT * INTO v_order') AS order_read_position,
    strpos(definition, 'merchant.user_id = (SELECT auth.uid())') AS owner_position
  FROM function_def
)
SELECT ok(
  lock_position > 0
    AND order_read_position > lock_position
    AND owner_position > order_read_position,
  'reservation locks the order before checking owner authorization'
)
FROM positions;

WITH function_def AS (
  SELECT pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  ) AS definition
), positions AS (
  SELECT
    strpos(definition, 'IF v_existing.id IS NOT NULL THEN') AS existing_position,
    strpos(definition, 'wallet_reservation_owner_required') AS owner_gate_position,
    strpos(definition, 'FROM public.merchant_wallets') AS wallet_position
  FROM function_def
)
SELECT ok(
  existing_position > 0
    AND owner_gate_position > existing_position
    AND wallet_position > owner_gate_position,
  'owner-only gate sits after existing-charge recovery and before wallet debit'
)
FROM positions;

WITH function_def AS (
  SELECT pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  ) AS definition
)
SELECT ok(
  strpos(definition, 'check_staff_permission') > 0
    AND strpos(definition, '''orders'', ''fulfill''') > 0
    AND strpos(definition, '''orders'', ''edit''') > 0,
  'staff fulfill/edit may resume existing reserved charges'
)
FROM function_def;

WITH function_def AS (
  SELECT pg_get_functiondef(
    'public.reserve_merchant_shipping_charge(uuid, uuid, text)'::regprocedure
  ) AS definition
)
SELECT ok(
  strpos(definition, 'FOR UPDATE') > 0
    AND strpos(definition, 'RAISE EXCEPTION ''order_not_owned''') > 0
    AND strpos(definition, 'RAISE EXCEPTION ''wallet_reservation_owner_required''') > 0,
  'unauthorized new reservations fail closed after the row lock'
)
FROM function_def;

SELECT * FROM finish();

ROLLBACK;
