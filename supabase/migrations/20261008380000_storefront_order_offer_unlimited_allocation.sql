-- Append-only: enforce the offer allocation for serialized-unlimited orders.
--
-- The stock loop bypasses the legacy scalar decrement for serialized
-- inventory policies before reaching the M13 offer branch. For a
-- serialized_then_unlimited product with a finite offer allocation, the
-- serialized claim helper then allows the missing units as unlimited
-- fallback: the order consumes more than the merchant's advertised offer
-- allocation while search (M18), the PDP, and the cart all cap it at that
-- scalar quantity.
--
-- Fix: qualify the bypass so offer lines on serialized-then-unlimited
-- products still take the scalar branch (check + decrement, or
-- insufficient_offer_stock). Narrow to the unlimited policy on purpose:
-- serialized_strict stays claim-only, since strict serials (not the
-- scalar) are the source of truth there and the strict offer-cap
-- semantics are unverified. The claim path still runs for the line as
-- before; the scalar now gates first, transactionally.
--
-- Same pg_get_functiondef patch channel as M13/M17 (the loop lives in the
-- 24-arg create_storefront_order_unchecked since the 20260828 rename).
-- Fail closed when the M13 offer branch is absent; reruns converge.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname IN (
      'create_storefront_order',
      'create_storefront_order_unchecked'
    )
    AND function_definition.pronargs = 24
  ORDER BY CASE function_definition.proname
    WHEN 'create_storefront_order_unchecked' THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Fail closed when applied before the M13 offer branch this qualifies.
  IF strpos(v_definition, 'ELSIF stock_rec.offer_id IS NOT NULL THEN') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_branch_not_found';
  END IF;

  -- Reruns and already-patched bypasses converge without duplicating edits.
  IF strpos(v_definition, 'stock_rec.offer_id IS NULL') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$        IF v_effective_policy IN ('serialized_strict', 'serialized_then_unlimited') THEN
          -- Bypassed legacy stock decrement for serialized inventory tracking
          CONTINUE;
        END IF;$$,
    $$        IF v_effective_policy = 'serialized_strict'
          OR (v_effective_policy = 'serialized_then_unlimited' AND stock_rec.offer_id IS NULL)
        THEN
          -- Bypassed legacy stock decrement for serialized inventory tracking.
          -- Offer lines on serialized-then-unlimited products still take the
          -- scalar branch below: the finite offer allocation binds the order
          -- the same way search and the PDP bind availability.
          CONTINUE;
        END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_serialized_bypass_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;
