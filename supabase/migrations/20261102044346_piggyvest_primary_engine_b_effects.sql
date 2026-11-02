-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 4 of 6: the B-effect ledger.
--
-- B is the balance a customer can spend (customer_wallets.available_balance).
-- Program rule: B changes only through request_b_effect (part 5), once per
-- (transfer, effect). Each change is first recorded here, then applied
-- inline in an allowlisted engine session or later by the worker pass. The
-- row keeps who requested it and who applied it, and links the one
-- customer_wallet_transactions row the change wrote.
--
-- family_collect groups a collect (or a goal purchase) with its refunds, so
-- the family's credits can be capped by its hold debit (R4); a goal
-- purchase never debited B, so its family is capped by the purchase amount.
-- b_credit_room answers how much a credit may still return.
--
-- session_may_write_b() answers whether the current session may write B
-- inline. It ships as a stub that is always false, so until the legacy
-- write backstop replaces it every session only requests and hold debits
-- (which must apply inline) are refused.
BEGIN;
CREATE TABLE piggyvest_primary.transfer_b_effects (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES piggyvest_primary.wallet_transfers(id),
  family_collect uuid REFERENCES piggyvest_primary.wallet_transfers(id),
  effect text NOT NULL CHECK (effect IN ('hold_debit', 'release_credit', 'unpaid_restore', 'refund_netted',
    'confirm_credit', 'payout_freeze_debit', 'payout_failed_restore')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  state text NOT NULL CHECK (state IN ('requested', 'applied', 'review')),
  review_reason text CHECK (review_reason IS NULL OR octet_length(review_reason) BETWEEN 1 AND 100),
  requested_by_login name NOT NULL,
  applied_by_login name,
  applied_at timestamptz,
  -- Account deletion removes the ledger row; the applied effect is kept.
  wallet_transaction_id uuid REFERENCES public.customer_wallet_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (transfer_id, effect),
  CHECK (state <> 'applied' OR (applied_by_login IS NOT NULL AND applied_at IS NOT NULL)),
  CHECK (state = 'applied' OR (applied_by_login IS NULL AND applied_at IS NULL AND wallet_transaction_id IS NULL)),
  CHECK ((state = 'review') = (review_reason IS NOT NULL))
);
CREATE INDEX piggyvest_primary_transfer_b_effects_family_idx ON piggyvest_primary.transfer_b_effects(family_collect);
CREATE INDEX piggyvest_primary_transfer_b_effects_ledger_idx ON piggyvest_primary.transfer_b_effects(wallet_transaction_id);
CREATE INDEX piggyvest_primary_transfer_b_effects_requested_idx ON piggyvest_primary.transfer_b_effects(created_at, id)
  WHERE state = 'requested';

-- Rows are append-only: a request moves once, to applied (with its ledger
-- row) or to review. Only account deletion may later clear the ledger link.
CREATE FUNCTION piggyvest_primary.transfer_b_effects_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'B effects are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('requested', 'review') OR NEW.wallet_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'a B effect starts requested or in review' USING ERRCODE = '23514';
    END IF;
    NEW.requested_by_login := SESSION_USER;
    NEW.created_at := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;
  IF OLD.state = 'applied' AND NEW.wallet_transaction_id IS NULL AND OLD.wallet_transaction_id IS NOT NULL
    AND (pg_catalog.to_jsonb(NEW) - 'wallet_transaction_id') = (pg_catalog.to_jsonb(OLD) - 'wallet_transaction_id') THEN
    RETURN NEW;
  END IF;
  IF OLD.state <> 'requested' OR NEW.state NOT IN ('applied', 'review')
    OR (NEW.state = 'applied' AND NEW.wallet_transaction_id IS NULL)
    OR (NEW.id, NEW.transfer_id, NEW.family_collect, NEW.effect, NEW.amount_kobo, NEW.requested_by_login, NEW.created_at)
      IS DISTINCT FROM
      (OLD.id, OLD.transfer_id, OLD.family_collect, OLD.effect, OLD.amount_kobo, OLD.requested_by_login, OLD.created_at)
  THEN
    RAISE EXCEPTION 'a B effect moves once, from requested to applied or review' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_b_effects_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.transfer_b_effects
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.transfer_b_effects_guard();

ALTER TABLE piggyvest_primary.transfer_b_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_transfer_b_effects_deny ON piggyvest_primary.transfer_b_effects
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.transfer_b_effects
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_transfer_enqueuer,
    piggyvest_primary_transfer_worker, piggyvest_primary_transfer_ops;

-- How much a credit may still return. backing names what stands behind it:
--   applied    the debit it returns took B (payout freeze or hold debit);
--   requested  that debit still waits for the worker;
--   missing    there is no such debit, or it went to review;
--   leg        no debit: the credit pays money that reached the customer's
--              main wallet (obligations, goal legs, refunds of a goal
--              purchase), within the leg or the purchase.
-- room_kobo is the cap less the family's other credits: requested and
-- applied ones when a request is checked, applied ones when it is applied.
CREATE FUNCTION piggyvest_primary.b_credit_room(p_family uuid, p_transfer_id uuid, p_effect text,
  p_applied_only boolean)
RETURNS TABLE (backing text, room_kobo bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_counted text[] := CASE WHEN p_applied_only THEN ARRAY['applied'] ELSE ARRAY['requested', 'applied'] END;
  v_family_kind text;
  v_cap bigint;
  v_state text;
  v_used bigint := 0;
BEGIN
  IF p_effect = 'payout_failed_restore' THEN
    SELECT effect.state, effect.amount_kobo INTO v_state, v_cap FROM piggyvest_primary.transfer_b_effects effect
      WHERE effect.transfer_id = p_transfer_id AND effect.effect = 'payout_freeze_debit';
    SELECT COALESCE(sum(effect.amount_kobo), 0) INTO v_used FROM piggyvest_primary.transfer_b_effects effect
      WHERE effect.transfer_id = p_transfer_id AND effect.effect = 'payout_failed_restore'
        AND effect.state = ANY (v_counted);
  ELSIF p_family IS NOT NULL THEN
    SELECT transfer.kind, transfer.amount_kobo INTO v_family_kind, v_cap FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_family;
    IF v_family_kind = 'collect' THEN
      SELECT effect.state, effect.amount_kobo INTO v_state, v_cap FROM piggyvest_primary.transfer_b_effects effect
        WHERE effect.transfer_id = p_family AND effect.effect = 'hold_debit';
    ELSIF p_effect = 'confirm_credit' THEN
      v_state := 'leg';
    END IF;
    SELECT COALESCE(sum(effect.amount_kobo), 0) INTO v_used FROM piggyvest_primary.transfer_b_effects effect
      WHERE effect.family_collect = p_family AND effect.effect <> 'hold_debit' AND effect.state = ANY (v_counted);
  ELSE
    SELECT 'leg', transfer.amount_kobo INTO v_state, v_cap FROM piggyvest_primary.wallet_transfers transfer
      WHERE transfer.id = p_transfer_id;
  END IF;
  backing := CASE WHEN v_state IN ('applied', 'requested', 'leg') THEN v_state ELSE 'missing' END;
  room_kobo := CASE WHEN backing = 'missing' THEN 0 ELSE v_cap - v_used END;
  RETURN NEXT;
END $$;

-- Stub: no session writes B inline until the legacy write backstop owns it.
CREATE FUNCTION piggyvest_primary.session_may_write_b() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT false /* engine-stub */ $$;

REVOKE ALL ON FUNCTION piggyvest_primary.transfer_b_effects_guard(), piggyvest_primary.session_may_write_b(),
  piggyvest_primary.b_credit_room(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
