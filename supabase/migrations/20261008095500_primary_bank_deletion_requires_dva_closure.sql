BEGIN;
-- Deleting a customer detaches their onboarding intent (customer_id SET
-- NULL) while the provider DVA stays open: a later bank deposit for the
-- detached wallet then matches no live binding but still matches the
-- retained provider ids, so enqueue_bank_inbox strands it as
-- blocked/financial_conflict with no owner who could ever resolve it.
-- The provider account must close before the local binding is removed.
-- No PiggyVest DVA-close API client exists in this repo, so the database
-- enforces the ordering instead: the operator attests provider-side
-- closure (dashboard/support flow) through attest_provider_dva_closure,
-- and customer deletion is rejected while any mapped intent (accepted/
-- verified carry provider ids; dispatched/unknown hold NULL and never
-- match) lacks that attestation. With the DVA closed first, late
-- deposits bounce at the provider instead of arriving into a void.
-- Append-only: earlier migrations are untouched (AGENTS.md).
ALTER TABLE piggyvest_primary.onboarding_intents
  ADD COLUMN provider_closed_at timestamptz;
-- Closure is a one-way attestation: it may only go from NULL to a value,
-- only on a mapped intent (nothing to close before provider ids exist),
-- and never back. Existing writers never touch the column, so their
-- updates pass through unchanged.
CREATE OR REPLACE FUNCTION piggyvest_primary.guard_intent_provider_closure()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.provider_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.provider_closed_at IS DISTINCT FROM OLD.provider_closed_at THEN
    IF OLD.provider_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'provider DVA closure is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.state NOT IN ('accepted', 'verified')
      OR NEW.provider_wallet_id IS NULL OR NEW.provider_customer_id IS NULL THEN
      RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS primary_intent_provider_closure_guard ON piggyvest_primary.onboarding_intents;
CREATE TRIGGER primary_intent_provider_closure_guard
  BEFORE INSERT OR UPDATE ON piggyvest_primary.onboarding_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_intent_provider_closure();
-- Idempotent: re-attesting an already-closed intent is a no-op so
-- operator retries never fail. Granted to the provisioning role — the
-- same surface that maps provider wallets also attests their closure.
CREATE FUNCTION piggyvest_primary.attest_provider_dva_closure(p_intent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent piggyvest_primary.onboarding_intents%ROWTYPE;
BEGIN
  IF p_intent IS NULL THEN
    RAISE EXCEPTION 'invalid closure intent' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO STRICT intent FROM piggyvest_primary.onboarding_intents WHERE id = p_intent FOR UPDATE;
  IF intent.state NOT IN ('accepted', 'verified') THEN
    RAISE EXCEPTION 'provider DVA closure requires a mapped intent' USING ERRCODE = '22023';
  END IF;
  IF intent.provider_closed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE piggyvest_primary.onboarding_intents
    SET provider_closed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = p_intent;
END $$;
-- The existing unsettled-deposits check is preserved verbatim; the
-- open-DVA check is appended so the offboard order is close, then
-- drain, then delete. Terminal intents (never mapped) cannot lock the
-- account, matching the existing rule.
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_bank_inbox_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.bank_signed_inbox inbox
    WHERE inbox.state IN ('pending','processing')
      AND EXISTS (
        SELECT 1 FROM piggyvest_primary.onboarding_intents intent
        WHERE intent.customer_id = OLD.id
          AND intent.provider_wallet_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'pvb_wallet')
          AND intent.provider_customer_id = (convert_from(inbox.payload,'UTF8')::jsonb->>'customer_id')
      )
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled bank deposits' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.onboarding_intents intent
    WHERE intent.customer_id = OLD.id
      AND intent.state IN ('accepted', 'verified')
      AND intent.provider_closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with open provider DVA' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
-- New routines default to PUBLIC execute, which would fail
-- bank_role_safe for the bank logins: revoke first (revoked trigger
-- functions still fire), then grant the attester to the provisioner.
REVOKE ALL ON FUNCTION piggyvest_primary.guard_intent_provider_closure(),
  piggyvest_primary.attest_provider_dva_closure(uuid)
  FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.attest_provider_dva_closure(uuid)
  TO piggyvest_primary_provisioner;
COMMIT;
