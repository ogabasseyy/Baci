-- PR #3555 round-5 review follow-ups: serialize pilot activation against
-- ordinary order inserts, and index the pilot-policy reservation keys.
--
-- Activation (configure_uba_redvault_live_pilot) verifies no prior order item
-- uses the product and then publishes policy.product_id, holding only
-- FOR UPDATE on the singleton policy row. The product-boundary trigger read
-- policy.product_id without a conflicting lock, so a concurrent ordinary
-- checkout could pass the boundary check against the old NULL binding while
-- activation observed no prior item; both then committed, leaving a
-- non-pilot order holding the restricted product. The boundary trigger now
-- reads the bound product under FOR SHARE -- the same row-lock pairing the
-- order-binding guard already uses -- so activation and restricted-product
-- inserts serialize: either the insert waits and then sees the published
-- product, or activation waits and then sees the committed item and refuses
-- to dedicate the product. FOR SHARE never blocks concurrent inserts against
-- each other, so ordinary checkouts are unaffected.
--
-- Also adds the missing indexes on the policy reservation foreign keys, as
-- the repository requires indexes on every foreign key.

CREATE OR REPLACE FUNCTION private.guard_uba_redvault_pilot_product_orders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  bound_product uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    -- Conflicting lock with activation's FOR UPDATE: serialize before
    -- reading the binding so a concurrent publish cannot slip past.
    SELECT policy.product_id INTO bound_product
    FROM private.uba_redvault_live_pilot_policy AS policy
    WHERE singleton FOR SHARE;
    IF bound_product IS NOT NULL
      AND bound_product = NEW.product_id
      AND NOT EXISTS (
        SELECT 1 FROM private.uba_redvault_write_context AS context
        WHERE context.transaction_id = pg_catalog.txid_current()
      ) THEN
      RAISE EXCEPTION 'redvault_pilot_product_restricted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS uba_redvault_live_pilot_policy_reserved_order_id_idx
  ON private.uba_redvault_live_pilot_policy(reserved_order_id);
CREATE INDEX IF NOT EXISTS uba_redvault_live_pilot_policy_reserved_attempt_id_idx
  ON private.uba_redvault_live_pilot_policy(reserved_attempt_id);
