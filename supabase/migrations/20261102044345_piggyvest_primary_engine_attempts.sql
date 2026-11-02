-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 3 of 6: transfer attempts and customer
-- spend holds.
--
-- R2: every submission to PiggyVest is an attempt with the reference
-- pvb-wt-<transfer>-<attempt>, unique forever. Attempts are never deleted,
-- their reference, amount and recorded provider evidence and times never
-- change, a confirmed, failed or aborted attempt is frozen whole, a
-- new attempt is allowed only once every earlier attempt is proven failed or
-- aborted (one open attempt per transfer), and a confirmed attempt ends the
-- transfer's attempts. amount_kobo is the amount a settlement proof must
-- bind to; it never exceeds what the transfer still has outstanding.
-- States only move forward: prepared -> dispatching or aborted; dispatching
-- -> submitted, unknown, confirmed or failed; submitted and unknown ->
-- each other, confirmed or failed. Only a prepared attempt (never sent) can
-- be aborted, so an attempt that may have reached PiggyVest can never be
-- written off to make room for a new reference.
--
-- Spend holds stop a customer from spending while something is wrong:
-- negative drift, a collect in review, a support payout freeze, or a
-- provider restriction. A hold is released once and never deleted; an
-- active hold also blocks deleting the customer's account.
BEGIN;
CREATE TABLE piggyvest_primary.wallet_transfer_attempts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES piggyvest_primary.wallet_transfers(id),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 1000),
  reference text NOT NULL UNIQUE,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  state text NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared', 'dispatching', 'submitted', 'unknown', 'confirmed', 'failed', 'aborted')),
  provider_transaction_id text UNIQUE CHECK (octet_length(provider_transaction_id) BETWEEN 1 AND 512),
  fee_kobo bigint CHECK (fee_kobo >= 0),
  proof jsonb CHECK (proof IS NULL OR jsonb_typeof(proof) = 'object'),
  lease_token uuid,
  lease_until timestamptz,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (transfer_id, attempt),
  CHECK (reference = 'pvb-wt-' || transfer_id::text || '-' || attempt::text),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (state NOT IN ('confirmed', 'failed') OR proof IS NOT NULL),
  CHECK (state <> 'confirmed' OR (provider_transaction_id IS NOT NULL AND fee_kobo IS NOT NULL))
);
CREATE UNIQUE INDEX piggyvest_primary_wallet_transfer_attempts_open_idx
  ON piggyvest_primary.wallet_transfer_attempts(transfer_id)
  WHERE state IN ('prepared', 'dispatching', 'submitted', 'unknown');
CREATE INDEX piggyvest_primary_wallet_transfer_attempts_lease_idx
  ON piggyvest_primary.wallet_transfer_attempts(state, lease_until)
  WHERE state IN ('dispatching', 'submitted', 'unknown');

CREATE FUNCTION piggyvest_primary.wallet_transfer_attempts_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_transfer piggyvest_primary.wallet_transfers%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attempt references are kept forever' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.transfer_id, NEW.attempt, NEW.reference, NEW.amount_kobo, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.transfer_id, OLD.attempt, OLD.reference, OLD.amount_kobo, OLD.created_at)
      OR (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id)
      OR (OLD.fee_kobo IS NOT NULL AND NEW.fee_kobo IS DISTINCT FROM OLD.fee_kobo)
      OR (OLD.proof IS NOT NULL AND NEW.proof IS DISTINCT FROM OLD.proof)
      OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
      OR (OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
      RAISE EXCEPTION 'attempt identity and recorded evidence are immutable' USING ERRCODE = '42501';
    END IF;
    -- A final attempt is frozen whole: nothing is added to it (a provider
    -- transaction id or fee it never recorded, a lease, a time), and nothing
    -- moves its state. An update that changes nothing writes nothing.
    IF OLD.state IN ('confirmed', 'failed', 'aborted') THEN
      IF (pg_catalog.to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'updated_at') THEN
        RAISE EXCEPTION 'attempt % is final', OLD.state USING ERRCODE = '55000';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.state <> OLD.state AND NOT (NEW.state = ANY (CASE OLD.state
        WHEN 'prepared' THEN ARRAY['dispatching', 'aborted']
        WHEN 'dispatching' THEN ARRAY['submitted', 'unknown', 'confirmed', 'failed']
        WHEN 'submitted' THEN ARRAY['unknown', 'confirmed', 'failed']
        WHEN 'unknown' THEN ARRAY['submitted', 'confirmed', 'failed'] END)) THEN
      RAISE EXCEPTION 'attempt cannot move from % to %', OLD.state, NEW.state USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;
  SELECT transfer.* INTO v_transfer FROM piggyvest_primary.wallet_transfers transfer
    WHERE transfer.id = NEW.transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.state IN ('confirmed', 'cancelled', 'failed_unpaid', 'netted') THEN
    RAISE EXCEPTION 'a settled transfer takes no new attempt' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_transfer_attempts earlier
    WHERE earlier.transfer_id = NEW.transfer_id AND earlier.state = 'confirmed') THEN
    RAISE EXCEPTION 'a confirmed transfer takes no new attempt' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempt IS DISTINCT FROM (SELECT COALESCE(max(earlier.attempt), 0) + 1
    FROM piggyvest_primary.wallet_transfer_attempts earlier WHERE earlier.transfer_id = NEW.transfer_id) THEN
    RAISE EXCEPTION 'attempt numbers are consecutive' USING ERRCODE = '23514';
  END IF;
  IF NEW.amount_kobo > v_transfer.outstanding_kobo THEN
    RAISE EXCEPTION 'an attempt cannot ask for more than is outstanding' USING ERRCODE = '23514';
  END IF;
  IF NEW.state <> 'prepared' THEN
    RAISE EXCEPTION 'an attempt starts prepared' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := pg_catalog.clock_timestamp();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_transfer_attempts_guard BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_primary.wallet_transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.wallet_transfer_attempts_guard();

CREATE TABLE piggyvest_primary.wallet_spend_holds (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  -- Account deletion detaches a released hold; an active hold blocks it.
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('negative_drift', 'collect_review', 'support_freeze', 'restriction')),
  transfer_id uuid REFERENCES piggyvest_primary.wallet_transfers(id),
  detail text CHECK (detail IS NULL OR octet_length(detail) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  released_at timestamptz,
  CHECK (reason <> 'collect_review' OR transfer_id IS NOT NULL)
);
CREATE UNIQUE INDEX piggyvest_primary_wallet_spend_holds_active_idx
  ON piggyvest_primary.wallet_spend_holds(customer_id, reason, transfer_id) NULLS NOT DISTINCT
  WHERE released_at IS NULL;
CREATE INDEX piggyvest_primary_wallet_spend_holds_customer_idx ON piggyvest_primary.wallet_spend_holds(customer_id);
CREATE INDEX piggyvest_primary_wallet_spend_holds_integration_idx ON piggyvest_primary.wallet_spend_holds(integration_id);
CREATE INDEX piggyvest_primary_wallet_spend_holds_transfer_idx ON piggyvest_primary.wallet_spend_holds(transfer_id);

CREATE FUNCTION piggyvest_primary.wallet_spend_holds_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'spend holds are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.released_at IS NOT NULL AND NEW.customer_id IS NULL AND OLD.customer_id IS NOT NULL
      AND (pg_catalog.to_jsonb(NEW) - 'customer_id') = (pg_catalog.to_jsonb(OLD) - 'customer_id') THEN
      RETURN NEW;
    END IF;
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'cannot delete a customer with an active spend hold' USING ERRCODE = 'P0001';
    END IF;
    IF (pg_catalog.to_jsonb(NEW) - 'released_at') <> (pg_catalog.to_jsonb(OLD) - 'released_at')
      OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'a spend hold may only be released, once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.integrations integration
    JOIN public.customers customer ON customer.merchant_id = integration.merchant_id
    WHERE integration.id = NEW.integration_id AND customer.id = NEW.customer_id) THEN
    RAISE EXCEPTION 'spend hold customer is not a customer of this integration' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := pg_catalog.clock_timestamp();
  NEW.released_at := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_spend_holds_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.wallet_spend_holds
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.wallet_spend_holds_guard();

ALTER TABLE piggyvest_primary.wallet_transfer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.wallet_spend_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_wallet_transfer_attempts_deny ON piggyvest_primary.wallet_transfer_attempts
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY primary_wallet_spend_holds_deny ON piggyvest_primary.wallet_spend_holds
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_transfer_attempts, piggyvest_primary.wallet_spend_holds
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_transfer_enqueuer,
    piggyvest_primary_transfer_worker, piggyvest_primary_transfer_ops;
REVOKE ALL ON FUNCTION piggyvest_primary.wallet_transfer_attempts_guard(), piggyvest_primary.wallet_spend_holds_guard()
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
