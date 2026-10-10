BEGIN;
CREATE TABLE piggyvest_primary_card.treasury_policy (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.settings(integration_id),
  treasury_binding_id uuid NOT NULL,
  owner_login name NOT NULL,
  source_wallet_id text NOT NULL CHECK(octet_length(source_wallet_id) BETWEEN 1 AND 512),
  max_operation_kobo bigint NOT NULL CHECK(max_operation_kobo BETWEEN 1 AND 9999999999),
  max_daily_kobo bigint NOT NULL CHECK(max_daily_kobo BETWEEN 1 AND 9007199254740991),
  max_reserved_kobo bigint NOT NULL CHECK(max_reserved_kobo BETWEEN 1 AND 9007199254740991),
  transfer_login name NOT NULL UNIQUE,
  custody_login name NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
CREATE INDEX primary_card_treasury_binding_idx ON piggyvest_primary_card.treasury_policy(treasury_binding_id);
CREATE TABLE piggyvest_primary_card.reservations (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.operations(id),
  treasury_binding_id uuid NOT NULL,
  source_wallet_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 9999999999),
  transfer_reference text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','consumed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX primary_card_reserved_binding_idx ON piggyvest_primary_card.reservations(treasury_binding_id);
CREATE TABLE piggyvest_primary_card.transfer_outbox (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.reservations(operation_id),
  state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','dispatching','submitted','unknown','completed')),
  claim_token uuid,
  CHECK((state='dispatching')=(claim_token IS NOT NULL)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE piggyvest_primary_card.treasury_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.transfer_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_treasury_deny ON piggyvest_primary_card.treasury_policy AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_reservations_deny ON piggyvest_primary_card.reservations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_transfer_deny ON piggyvest_primary_card.transfer_outbox AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary_card.treasury_policy,piggyvest_primary_card.reservations,piggyvest_primary_card.transfer_outbox FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence;

CREATE FUNCTION piggyvest_primary_card.reserve_treasury()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  policy piggyvest_primary_card.treasury_policy%ROWTYPE;
  binding record;
  ready boolean;
  daily numeric;
  reserved numeric;
BEGIN
  SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy WHERE integration_id=NEW.integration_id AND enabled FOR SHARE;
  PERFORM integration_id FROM piggyvest_primary_card.settings WHERE integration_id=NEW.integration_id AND enabled AND authorizer_login=SESSION_USER FOR SHARE;
  IF NOT FOUND OR to_regprocedure('prefunded_card.treasury_reservation_ready(uuid)') IS NULL THEN
    RAISE EXCEPTION 'treasury authority unavailable' USING ERRCODE='42501';
  END IF;
  EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING policy.treasury_binding_id;
  EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO ready USING policy.treasury_binding_id;
  IF ready IS DISTINCT FROM true OR binding.authorized_login <> policy.owner_login OR binding.source_wallet_id <> policy.source_wallet_id
    OR binding.merchant_id <> NEW.merchant_id OR binding.expected_business_id <> NEW.business_id OR binding.currency <> 'NGN'
    OR binding.source_wallet_id=NEW.destination_wallet_id OR NEW.amount_kobo>policy.max_operation_kobo THEN
    RAISE EXCEPTION 'treasury binding unavailable' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(sum(amount_kobo),0) INTO daily FROM piggyvest_primary_card.reservations
    WHERE treasury_binding_id=policy.treasury_binding_id AND created_at >= date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  SELECT COALESCE(sum(amount_kobo),0) INTO reserved FROM piggyvest_primary_card.reservations WHERE treasury_binding_id=policy.treasury_binding_id AND state='reserved';
  IF daily+NEW.amount_kobo>policy.max_daily_kobo OR reserved+NEW.amount_kobo>policy.max_reserved_kobo
    OR binding.verified_available_kobo::numeric-binding.reserved_kobo-binding.consumed_kobo<NEW.amount_kobo THEN
    RAISE EXCEPTION 'treasury capacity insufficient' USING ERRCODE='23514';
  END IF;
  EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo+$2 WHERE id=$1' USING policy.treasury_binding_id,NEW.amount_kobo;
  INSERT INTO piggyvest_primary_card.reservations(operation_id,treasury_binding_id,source_wallet_id,amount_kobo,transfer_reference)
    VALUES(NEW.id,policy.treasury_binding_id,policy.source_wallet_id,NEW.amount_kobo,'pvb-primary-transfer-'||NEW.id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_reserve_treasury AFTER INSERT ON piggyvest_primary_card.operations FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.reserve_treasury();
CREATE FUNCTION piggyvest_primary_card.enqueue_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM operation_id FROM piggyvest_primary_card.reservations WHERE operation_id=NEW.operation_id AND state='reserved' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing treasury reservation' USING ERRCODE='42501'; END IF;
  INSERT INTO piggyvest_primary_card.transfer_outbox(operation_id) VALUES(NEW.operation_id);
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_enqueue_transfer AFTER INSERT ON piggyvest_primary_card.collections FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.enqueue_transfer();
REVOKE ALL ON FUNCTION piggyvest_primary_card.reserve_treasury(),piggyvest_primary_card.enqueue_transfer() FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence;
CREATE FUNCTION piggyvest_primary_card.guard_treasury_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(OLD)-'enabled') IS DISTINCT FROM (to_jsonb(NEW)-'enabled') THEN
    RAISE EXCEPTION 'primary treasury identity and limits immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_treasury_policy_guard BEFORE UPDATE OR DELETE ON piggyvest_primary_card.treasury_policy
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.guard_treasury_policy();
REVOKE ALL ON FUNCTION piggyvest_primary_card.guard_treasury_policy() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION piggyvest_primary_card.guard_collection_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ready boolean; binding_id uuid;
BEGIN
  IF OLD.state='reserved' AND NEW.state='initializing' THEN
    SELECT reservation.treasury_binding_id INTO STRICT binding_id FROM piggyvest_primary_card.reservations reservation
      JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=OLD.integration_id
      WHERE reservation.operation_id=OLD.id AND reservation.state='reserved' AND policy.enabled
        AND policy.treasury_binding_id=reservation.treasury_binding_id AND policy.source_wallet_id=reservation.source_wallet_id FOR SHARE;
    EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO ready USING binding_id;
    IF ready IS DISTINCT FROM true THEN RAISE EXCEPTION 'collection treasury unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_collection_dispatch_guard BEFORE UPDATE ON piggyvest_primary_card.operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.guard_collection_dispatch();
REVOKE ALL ON FUNCTION piggyvest_primary_card.guard_collection_dispatch() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
