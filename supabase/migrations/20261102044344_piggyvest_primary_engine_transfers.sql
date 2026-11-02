-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 2 of 6: wallet_transfers. Its attempts and
-- the customer spend holds are part 3.
--
-- One row per money movement. The (kind, source role, destination role)
-- triple must be a row of transfer_kinds, and the database pins the actual
-- PiggyVest wallets from the registries when the row is created: the
-- customer's verified main wallet, the goal's enabled wallet, the enabled
-- house wallet (verified, and registered for the integration's current
-- business), or an enabled bank destination. Identity is frozen after
-- insert, settled states are final, and row_version is bumped by its own
-- trigger on every update so approvals can bind to an exact version.
--
-- Each submission to PiggyVest is an attempt with the reference
-- pvb-wt-<transfer>-<attempt>. References are unique forever: attempts are
-- never deleted, a new attempt is allowed only once every earlier one is
-- proven failed or aborted, and a confirmed transfer takes no new attempt.
-- The transfer follows its attempts: it confirms only with a confirmed
-- attempt, it cannot end cancelled, unpaid or netted while an attempt may
-- still move money (or has), and its outstanding amount is never netted
-- below an attempt in flight.
BEGIN;
CREATE TABLE piggyvest_primary.wallet_transfers (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  kind text NOT NULL,
  source_role text NOT NULL,
  destination_role text NOT NULL,
  purpose text NOT NULL CHECK (octet_length(purpose) BETWEEN 1 AND 64),
  delivery_mode text NOT NULL CHECK (octet_length(delivery_mode) BETWEEN 1 AND 64),
  source_ref text NOT NULL CHECK (octet_length(source_ref) BETWEEN 1 AND 200),
  -- Account or goal deletion detaches a settled transfer (the evidence is
  -- kept); the guard refuses it while the transfer or its B effects are open.
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.customer_savings_goals(id) ON DELETE SET NULL,
  source_wallet_id text CHECK (octet_length(source_wallet_id) BETWEEN 1 AND 512),
  destination_wallet_id text CHECK (octet_length(destination_wallet_id) BETWEEN 1 AND 512),
  bank_destination_id uuid REFERENCES piggyvest_primary.bank_destinations(id),
  refund_of uuid REFERENCES piggyvest_primary.wallet_transfers(id),
  -- The foreign key to the goal exit claim is added by the exit-claim change.
  exit_claim_id uuid,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9999999999),
  outstanding_kobo bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('held', 'ready', 'awaiting_collect', 'dispatching', 'submitted', 'unknown',
    'confirmed', 'cancelled', 'failed_unpaid', 'netted', 'awaiting_float', 'review')),
  effect_state text NOT NULL DEFAULT 'pending' CHECK (effect_state IN ('pending', 'applied', 'review')),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (kind, source_role, destination_role)
    REFERENCES piggyvest_primary.transfer_kinds(kind, source_role, destination_role),
  UNIQUE (integration_id, kind, source_ref),
  CHECK (outstanding_kobo BETWEEN 0 AND amount_kobo),
  CHECK (source_wallet_id IS NOT NULL),
  CHECK (source_wallet_id IS DISTINCT FROM destination_wallet_id),
  CHECK ((destination_role = 'bank') = (bank_destination_id IS NOT NULL)),
  CHECK ((destination_role = 'bank') = (destination_wallet_id IS NULL)),
  CHECK (source_role IN ('main', 'goal') OR destination_role IN ('main', 'goal') OR customer_id IS NULL),
  CHECK (source_role = 'goal' OR destination_role = 'goal' OR goal_id IS NULL),
  CHECK ((kind = 'disbursement' AND purpose = 'refund') = (refund_of IS NOT NULL)),
  -- R3: every goal exit leg needs the goal's exit claim.
  CHECK ((kind IN ('goal_purchase', 'goal_refund', 'goal_leftover', 'goal_sweep', 'goal_forfeit'))
    = (exit_claim_id IS NOT NULL)),
  CHECK (state <> 'held' OR kind IN ('collect', 'goal_purchase')),
  -- Default 1: physical goods ship only after the collect is confirmed.
  CHECK (kind <> 'collect' OR (purpose = 'checkout') = (delivery_mode = 'deliver_after_confirm')),
  CHECK (state <> 'failed_unpaid' OR delivery_mode = 'deliver_after_confirm' OR kind = 'support_payout'),
  CHECK (state <> 'netted' OR kind IN ('collect', 'disbursement')),
  CHECK (state <> 'awaiting_collect' OR (kind = 'disbursement' AND purpose = 'refund')),
  CHECK (state <> 'awaiting_float' OR source_role = 'collection')
);
CREATE INDEX piggyvest_primary_wallet_transfers_kind_idx
  ON piggyvest_primary.wallet_transfers(kind, source_role, destination_role);
CREATE INDEX piggyvest_primary_wallet_transfers_customer_idx ON piggyvest_primary.wallet_transfers(customer_id);
CREATE INDEX piggyvest_primary_wallet_transfers_goal_idx ON piggyvest_primary.wallet_transfers(goal_id);
CREATE INDEX piggyvest_primary_wallet_transfers_bank_idx ON piggyvest_primary.wallet_transfers(bank_destination_id);
CREATE INDEX piggyvest_primary_wallet_transfers_refund_idx ON piggyvest_primary.wallet_transfers(refund_of);
CREATE INDEX piggyvest_primary_wallet_transfers_claim_idx ON piggyvest_primary.wallet_transfers(exit_claim_id);
CREATE INDEX piggyvest_primary_wallet_transfers_open_idx ON piggyvest_primary.wallet_transfers(state, seq)
  WHERE state NOT IN ('confirmed', 'cancelled', 'failed_unpaid', 'netted');

CREATE FUNCTION piggyvest_primary.wallet_transfers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_kind piggyvest_primary.transfer_kinds%ROWTYPE;
  v_refunded piggyvest_primary.wallet_transfers%ROWTYPE;
  v_mutable text[] := ARRAY['state', 'outstanding_kobo', 'effect_state', 'updated_at', 'row_version',
    'customer_id', 'goal_id'];
  v_merchant uuid;
  v_side text;
  v_role text;
  v_wallet text;
  v_stack text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'wallet transfers are append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (pg_catalog.to_jsonb(NEW) - v_mutable) <> (pg_catalog.to_jsonb(OLD) - v_mutable) THEN
      RAISE EXCEPTION 'a wallet transfer identity is immutable' USING ERRCODE = '42501';
    END IF;
    IF (NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.goal_id IS DISTINCT FROM OLD.goal_id) THEN
      IF (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
        OR (NEW.goal_id IS DISTINCT FROM OLD.goal_id AND NEW.goal_id IS NOT NULL) THEN
        RAISE EXCEPTION 'a wallet transfer identity is immutable' USING ERRCODE = '42501';
      END IF;
      IF OLD.state NOT IN ('confirmed', 'cancelled', 'failed_unpaid', 'netted')
        OR EXISTS (SELECT 1 FROM piggyvest_primary.transfer_b_effects effect
          WHERE effect.transfer_id = OLD.id AND effect.state = 'requested') THEN
        RAISE EXCEPTION 'cannot delete a customer or goal with an unsettled wallet transfer' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.outstanding_kobo > OLD.outstanding_kobo THEN
      RAISE EXCEPTION 'an outstanding amount never grows' USING ERRCODE = '42501';
    END IF;
    IF NEW.outstanding_kobo < OLD.outstanding_kobo AND EXISTS (SELECT 1
      FROM piggyvest_primary.wallet_transfer_attempts attempt WHERE attempt.transfer_id = OLD.id
        AND attempt.state IN ('prepared', 'dispatching', 'submitted', 'unknown')
        AND attempt.amount_kobo > NEW.outstanding_kobo) THEN
      RAISE EXCEPTION 'cannot net a transfer below an attempt in flight' USING ERRCODE = '55000';
    END IF;
    IF NEW.state <> OLD.state
      AND (OLD.state IN ('confirmed', 'cancelled', 'failed_unpaid', 'netted') OR NEW.state = 'held') THEN
      RAISE EXCEPTION 'wallet transfer cannot move from % to %', OLD.state, NEW.state USING ERRCODE = '55000';
    END IF;
    -- An ambiguous or successful attempt never ends as unpaid; ambiguity goes
    -- to review instead.
    IF NEW.state <> OLD.state AND NEW.state IN ('cancelled', 'failed_unpaid', 'netted') AND EXISTS (SELECT 1
      FROM piggyvest_primary.wallet_transfer_attempts attempt WHERE attempt.transfer_id = OLD.id
        AND attempt.state IN ('prepared', 'dispatching', 'submitted', 'unknown', 'confirmed')) THEN
      RAISE EXCEPTION 'a transfer with an attempt in flight or confirmed cannot become %', NEW.state
        USING ERRCODE = '55000';
    END IF;
    IF NEW.state <> OLD.state AND NEW.state = 'confirmed' AND NOT EXISTS (SELECT 1
      FROM piggyvest_primary.wallet_transfer_attempts attempt
      WHERE attempt.transfer_id = OLD.id AND attempt.state = 'confirmed') THEN
      RAISE EXCEPTION 'a transfer confirms only with a confirmed attempt' USING ERRCODE = '55000';
    END IF;
    IF OLD.effect_state = 'applied' AND NEW.effect_state <> 'applied' THEN
      RAISE EXCEPTION 'applied effects are final' USING ERRCODE = '55000';
    END IF;
    NEW.updated_at := pg_catalog.clock_timestamp();
    RETURN NEW;
  END IF;

  SELECT kind.* INTO v_kind FROM piggyvest_primary.transfer_kinds kind
    WHERE kind.kind = NEW.kind AND kind.source_role = NEW.source_role AND kind.destination_role = NEW.destination_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer kind % does not move money from % to %', NEW.kind, NEW.source_role, NEW.destination_role
      USING ERRCODE = '23503';
  END IF;
  IF v_kind.approval_only THEN
    -- Approval-only kinds are written only from their one pre-declared
    -- enqueue function (plpgsql, search_path pinned, so its frame is
    -- schema-qualified). The call stack quotes the text of every statement
    -- on it, so dynamic SQL could carry a copy of that frame line: any
    -- dynamic-SQL frame on the stack is refused outright.
    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack !~ ('(^|\n)PL/pgSQL function piggyvest_primary\.enqueue_misrouted_interest_sweep'
        || '\(uuid,uuid,text,bigint,uuid\) line [0-9]+ at [^\n]+(\n|$)')
      OR v_stack ~ '(^|\n)PL/pgSQL function [^\n]* line [0-9]+ at (EXECUTE|FOR over EXECUTE statement|RETURN QUERY|OPEN)(\n|$)'
    THEN
      RAISE EXCEPTION '% transfers are created only by enqueue_misrouted_interest_sweep', NEW.kind
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT (NEW.purpose = ANY (v_kind.purposes)) OR NOT (NEW.delivery_mode = ANY (v_kind.delivery_modes)) THEN
    RAISE EXCEPTION 'purpose or delivery mode not allowed for %', NEW.kind USING ERRCODE = '23514';
  END IF;
  IF NEW.state NOT IN ('held', 'ready', 'awaiting_collect', 'awaiting_float') THEN
    RAISE EXCEPTION 'a transfer starts held, ready or waiting' USING ERRCODE = '23514';
  END IF;
  SELECT integration.merchant_id INTO v_merchant FROM piggyvest_primary.integrations integration
    WHERE integration.id = NEW.integration_id;
  IF (NEW.customer_id IS NULL AND (NEW.source_role IN ('main', 'goal') OR NEW.destination_role IN ('main', 'goal')))
    OR (NEW.goal_id IS NULL AND 'goal' IN (NEW.source_role, NEW.destination_role)) THEN
    RAISE EXCEPTION 'a customer or goal leg names its customer and goal' USING ERRCODE = '23514';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers customer
    WHERE customer.id = NEW.customer_id AND customer.merchant_id = v_merchant) THEN
    RAISE EXCEPTION 'transfer customer is not a customer of this integration' USING ERRCODE = '23514';
  END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customer_savings_goals goal
    WHERE goal.id = NEW.goal_id AND goal.customer_id = NEW.customer_id AND goal.merchant_id = v_merchant) THEN
    RAISE EXCEPTION 'transfer goal is not a goal of this customer' USING ERRCODE = '23514';
  END IF;
  -- A refund pays back a collect or a goal purchase of the same customer.
  IF NEW.refund_of IS NOT NULL THEN
    SELECT refunded.* INTO v_refunded FROM piggyvest_primary.wallet_transfers refunded WHERE refunded.id = NEW.refund_of;
    IF NOT FOUND OR v_refunded.kind NOT IN ('collect', 'goal_purchase') OR v_refunded.integration_id <> NEW.integration_id
      OR v_refunded.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'a refund must refund a collect or goal purchase of the same customer' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOREACH v_side IN ARRAY ARRAY['source', 'destination'] LOOP
    v_role := CASE v_side WHEN 'source' THEN NEW.source_role ELSE NEW.destination_role END;
    v_wallet := NULL;
    IF v_role = 'bank' THEN
      PERFORM 1 FROM piggyvest_primary.bank_destinations bank
        WHERE bank.id = NEW.bank_destination_id AND bank.integration_id = NEW.integration_id AND bank.enabled
          AND bank.purpose = CASE NEW.kind WHEN 'treasury_sweep' THEN 'treasury' ELSE 'support_payout' END
          AND bank.customer_id IS NOT DISTINCT FROM NEW.customer_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'bank destination unavailable' USING ERRCODE = '23514'; END IF;
      CONTINUE;
    ELSIF v_role = 'main' THEN
      SELECT intent.provider_wallet_id INTO v_wallet FROM piggyvest_primary.onboarding_intents intent
        WHERE intent.integration_id = NEW.integration_id AND intent.customer_id = NEW.customer_id
          AND intent.state = 'verified';
    ELSIF v_role = 'goal' THEN
      -- enabled is the goal mapping's kill switch, as on every savings path.
      SELECT destination.provider_wallet_id INTO v_wallet FROM piggyvest_primary.savings_destinations destination
        JOIN piggyvest_primary.onboarding_intents intent ON intent.id = destination.intent_id
        WHERE destination.integration_id = NEW.integration_id AND destination.goal_id = NEW.goal_id
          AND destination.enabled AND intent.customer_id = NEW.customer_id AND intent.state = 'verified';
    ELSE
      -- A house wallet is registered for one business: it moves money only
      -- while it is verified and that business is still the integration's.
      SELECT house.provider_wallet_id INTO v_wallet FROM piggyvest_primary.house_wallets house
        JOIN piggyvest_primary.integrations integration ON integration.id = house.integration_id
        WHERE house.integration_id = NEW.integration_id AND house.role = v_role AND house.enabled
          AND house.verified_at IS NOT NULL AND house.business_id = integration.business_id;
    END IF;
    IF v_wallet IS NULL THEN
      RAISE EXCEPTION '% wallet unavailable for this transfer', v_role USING ERRCODE = '23514';
    END IF;
    IF v_role IN ('main', 'goal') AND EXISTS (SELECT 1 FROM piggyvest_primary.house_wallets house
      WHERE house.provider_wallet_id = v_wallet) THEN
      RAISE EXCEPTION 'a house wallet is never a customer wallet' USING ERRCODE = '23514';
    END IF;
    -- The reverse: no money moves into or out of a house wallet that a
    -- customer record also claims.
    IF v_role NOT IN ('main', 'goal') AND (
      EXISTS (SELECT 1 FROM piggyvest_primary.onboarding_intents intent WHERE intent.provider_wallet_id = v_wallet)
      OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_wallet_intents intent WHERE intent.provider_wallet_id = v_wallet)
      OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_destinations destination
        WHERE destination.provider_wallet_id = v_wallet)) THEN
      RAISE EXCEPTION 'a house wallet that a customer record claims is unavailable' USING ERRCODE = '23514';
    END IF;
    IF v_side = 'source' THEN
      IF NEW.source_wallet_id IS DISTINCT FROM v_wallet AND NEW.source_wallet_id IS NOT NULL THEN
        RAISE EXCEPTION 'source wallet does not match the % wallet', v_role USING ERRCODE = '23514';
      END IF;
      NEW.source_wallet_id := v_wallet;
    ELSE
      IF NEW.destination_wallet_id IS DISTINCT FROM v_wallet AND NEW.destination_wallet_id IS NOT NULL THEN
        RAISE EXCEPTION 'destination wallet does not match the % wallet', v_role USING ERRCODE = '23514';
      END IF;
      NEW.destination_wallet_id := v_wallet;
    END IF;
  END LOOP;
  NEW.outstanding_kobo := NEW.amount_kobo;
  NEW.effect_state := 'pending';
  NEW.row_version := 1;
  NEW.created_at := pg_catalog.clock_timestamp();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_transfers_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.wallet_transfers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.wallet_transfers_guard();

CREATE FUNCTION piggyvest_primary.wallet_transfers_row_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.row_version IS DISTINCT FROM OLD.row_version THEN
    RAISE EXCEPTION 'row_version is maintained by the database' USING ERRCODE = '42501';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_transfers_row_version BEFORE UPDATE ON piggyvest_primary.wallet_transfers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.wallet_transfers_row_version();

ALTER TABLE piggyvest_primary.wallet_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_wallet_transfers_deny ON piggyvest_primary.wallet_transfers
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_transfers
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_transfer_enqueuer,
    piggyvest_primary_transfer_worker, piggyvest_primary_transfer_ops;
REVOKE ALL ON FUNCTION piggyvest_primary.wallet_transfers_guard(), piggyvest_primary.wallet_transfers_row_version()
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
