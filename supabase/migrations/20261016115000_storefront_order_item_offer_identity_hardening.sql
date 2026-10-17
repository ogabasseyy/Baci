-- Harden creation-time order-line identity (additive follow-up).
--
-- 1. offer_id_snapshot was trust-on-insert: a caller-supplied value was
--    preserved verbatim, and NULL -> value updates passed unchecked, so
--    the "immutable purchased identity" was forgeable by any permitted
--    writer and then shown to fulfillment staff. Derive it
--    unconditionally from NEW.offer_id on INSERT; on UPDATE, a NULL ->
--    value transition must equal the live FK or it fails closed.
-- 2. offer_line (the restock discriminator) defaulted to false on direct
--    inserts and was freely updatable, so an offer line could be flipped
--    into the parent restock branch — cancelling it would then increment
--    parent stock that creation never decremented. Derive it from the
--    offer identity on INSERT and freeze it afterwards.
-- The order RPCs already stage both fields correctly, so the derivation
-- is a no-op for them and a correction for every other writer. Reruns
-- converge.
CREATE OR REPLACE FUNCTION private.guard_order_items_offer_id_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Derive, never trust: any caller-supplied snapshot or
    -- discriminator is overwritten from the live offer identity.
    NEW.offer_id_snapshot := NEW.offer_id;
    NEW.offer_line := NEW.offer_id IS NOT NULL;
    RETURN NEW;
  END IF;
  -- UPDATE: the snapshot is immutable once stamped. The only exception
  -- is stamping pre-hardening rows whose snapshot is still NULL — and
  -- even then the value must equal the live FK, never an arbitrary
  -- writer-supplied UUID. (FK ON DELETE SET NULL only nulls offer_id,
  -- leaving both guarded fields untouched, so deletes still pass.)
  IF OLD.offer_id_snapshot IS NULL AND NEW.offer_id_snapshot IS NOT NULL THEN
    IF NEW.offer_id_snapshot IS DISTINCT FROM NEW.offer_id THEN
      RAISE EXCEPTION 'order_items.offer_id_snapshot must match offer_id (order %, item %)',
        NEW.order_id, NEW.id;
    END IF;
  ELSIF OLD.offer_id_snapshot IS NOT NULL
     AND NEW.offer_id_snapshot IS DISTINCT FROM OLD.offer_id_snapshot THEN
    RAISE EXCEPTION 'order_items.offer_id_snapshot is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  IF NEW.offer_line IS DISTINCT FROM OLD.offer_line THEN
    RAISE EXCEPTION 'order_items.offer_line is immutable (order %, item %)',
      NEW.order_id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
