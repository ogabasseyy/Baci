BEGIN;

CREATE FUNCTION prefunded_card.require_treasury_role(required_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE role_id oid;
BEGIN
  role_id := to_regrole(required_role);
  IF role_id IS NULL OR NOT pg_has_role(session_user, role_id, 'member') THEN
    RAISE EXCEPTION 'prefunded treasury role denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.provision_treasury_identity(
  binding_id uuid, integration_id uuid, merchant_id uuid, expected_business_id text,
  source_wallet_id text, authorized_login name, opening_available_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  IF binding_id IS NULL OR integration_id IS NULL OR merchant_id IS NULL
    OR expected_business_id IS NULL OR source_wallet_id IS NULL OR authorized_login IS NULL
    OR opening_available_kobo IS NULL OR opening_available_kobo NOT BETWEEN 1 AND 9007199254740991
    OR octet_length(expected_business_id) NOT BETWEEN 1 AND 512
    OR octet_length(source_wallet_id) NOT BETWEEN 1 AND 512
    OR to_regrole(authorized_login::text) IS NULL
    OR NOT pg_has_role(authorized_login, 'prefunded_treasury_ledger_worker', 'member') THEN
    RAISE EXCEPTION 'invalid prefunded treasury identity' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities
    WHERE treasury_binding_id = binding_id FOR UPDATE;
  IF FOUND THEN
    IF identity.integration_id = provision_treasury_identity.integration_id
      AND identity.merchant_id = provision_treasury_identity.merchant_id
      AND identity.expected_business_id = provision_treasury_identity.expected_business_id
      AND identity.source_wallet_id = provision_treasury_identity.source_wallet_id
      AND identity.authorized_login = provision_treasury_identity.authorized_login
      AND identity.opening_available_kobo = provision_treasury_identity.opening_available_kobo THEN
      RETURN 'duplicate';
    END IF;
    RAISE EXCEPTION 'conflicting prefunded treasury identity' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = provision_treasury_identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = provision_treasury_identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_bindings (
    id, integration_id, merchant_id, expected_business_id, source_wallet_id, currency,
    verified_available_kobo, reserved_kobo, consumed_kobo, verified_at, authorized_login, enabled
  ) VALUES (
    binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id, 'NGN',
    opening_available_kobo, 0, 0, clock_timestamp(), authorized_login, true
  );
  INSERT INTO prefunded_card.treasury_identities (
    treasury_binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id,
    authorized_login, opening_available_kobo, provisioned_by
  ) VALUES (
    binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id,
    authorized_login, opening_available_kobo, session_user
  );
  RETURN 'provisioned';
END $$;

CREATE FUNCTION prefunded_card.record_treasury_snapshot(
  binding_id uuid, evidence_id text, sequence_number bigint, observed_at timestamptz,
  available_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE existing prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE latest prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_verifier');
  IF binding_id IS NULL OR evidence_id IS NULL OR sequence_number IS NULL OR observed_at IS NULL
    OR available_kobo IS NULL OR sequence_number NOT BETWEEN 1 AND 9007199254740991
    OR available_kobo NOT BETWEEN 0 AND 9007199254740991
    OR octet_length(evidence_id) NOT BETWEEN 1 AND 128
    OR observed_at NOT BETWEEN clock_timestamp() - interval '15 minutes'
      AND clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'invalid prefunded treasury snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury binding denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN
    RAISE EXCEPTION 'prefunded treasury identity denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
      AND stored.evidence_id = record_treasury_snapshot.evidence_id FOR UPDATE;
  IF FOUND THEN
    IF existing.sequence_number = record_treasury_snapshot.sequence_number
      AND existing.observed_at = record_treasury_snapshot.observed_at
      AND existing.available_kobo = record_treasury_snapshot.available_kobo THEN RETURN 'duplicate'; END IF;
    RAISE EXCEPTION 'conflicting prefunded treasury snapshot' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO latest FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
    ORDER BY stored.sequence_number DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (sequence_number <= latest.sequence_number OR observed_at <= latest.observed_at) THEN
    RAISE EXCEPTION 'non-monotonic prefunded treasury snapshot' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_snapshots (
    treasury_binding_id, evidence_id, sequence_number, observed_at, available_kobo, verified_by
  ) VALUES (binding_id, evidence_id, sequence_number, observed_at, available_kobo, session_user);
  UPDATE prefunded_card.treasury_bindings SET verified_at = observed_at WHERE id = binding_id;
  RETURN 'recorded';
END $$;

CREATE FUNCTION prefunded_card.treasury_reservation_ready(binding_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE snapshot prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE replenished_kobo bigint;
DECLARE expected_available_kobo bigint;
BEGIN
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN RETURN false; END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO snapshot FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
    ORDER BY stored.sequence_number DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR snapshot.observed_at < clock_timestamp() - interval '15 minutes'
    OR snapshot.observed_at > clock_timestamp() + interval '1 minute' THEN RETURN false; END IF;
  SELECT coalesce(sum(replenishment.amount_kobo), 0) INTO replenished_kobo
    FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id;
  expected_available_kobo := identity.opening_available_kobo + replenished_kobo - binding.consumed_kobo;
  RETURN expected_available_kobo >= 0 AND binding.verified_available_kobo = identity.opening_available_kobo + replenished_kobo
    AND binding.reserved_kobo + binding.consumed_kobo <= binding.verified_available_kobo
    AND snapshot.available_kobo = expected_available_kobo;
END $$;

CREATE FUNCTION prefunded_card.approve_treasury_replenishment(
  replenishment_id uuid, binding_id uuid, snapshot_evidence_id text,
  reconciliation_reference text, amount_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE snapshot prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE replenished_kobo bigint;
DECLARE expected_before_kobo bigint;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  IF replenishment_id IS NULL OR binding_id IS NULL OR snapshot_evidence_id IS NULL
    OR reconciliation_reference IS NULL OR amount_kobo IS NULL
    OR amount_kobo NOT BETWEEN 1 AND 9007199254740991
    OR octet_length(snapshot_evidence_id) NOT BETWEEN 1 AND 128
    OR octet_length(reconciliation_reference) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid prefunded treasury replenishment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  SELECT * INTO snapshot FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
      AND stored.evidence_id = approve_treasury_replenishment.snapshot_evidence_id FOR SHARE;
  IF NOT FOUND OR identity.treasury_binding_id IS NULL OR snapshot.verified_by = session_user
    OR snapshot.observed_at NOT BETWEEN clock_timestamp() - interval '15 minutes'
      AND clock_timestamp() + interval '1 minute'
    OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN
    RAISE EXCEPTION 'prefunded treasury replenishment denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id
      AND replenishment.snapshot_evidence_id = approve_treasury_replenishment.snapshot_evidence_id) THEN
    RAISE EXCEPTION 'prefunded treasury snapshot already reconciled' USING ERRCODE = '42501';
  END IF;
  IF snapshot.sequence_number <> (
    SELECT max(stored.sequence_number) FROM prefunded_card.treasury_snapshots AS stored
      WHERE stored.treasury_binding_id = binding_id
  ) THEN
    RAISE EXCEPTION 'prefunded treasury snapshot stale' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(replenishment.amount_kobo), 0) INTO replenished_kobo
    FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id;
  expected_before_kobo := identity.opening_available_kobo + replenished_kobo - binding.consumed_kobo;
  IF expected_before_kobo < 0 OR snapshot.available_kobo <> expected_before_kobo + amount_kobo THEN
    RAISE EXCEPTION 'prefunded treasury reconciliation mismatch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_replenishments (
    id, treasury_binding_id, snapshot_evidence_id, reconciliation_reference, amount_kobo, approved_by
  ) VALUES (replenishment_id, binding_id, snapshot_evidence_id, reconciliation_reference, amount_kobo, session_user);
  UPDATE prefunded_card.treasury_bindings SET verified_available_kobo = verified_available_kobo + amount_kobo
    WHERE id = binding_id;
  RETURN 'replenished';
END $$;

ALTER FUNCTION prefunded_card.reserve(jsonb) RENAME TO reserve_pre_treasury_guard;
CREATE FUNCTION prefunded_card.reserve(command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding_text text;
BEGIN
  IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  binding_text := command->>'treasuryBindingId';
  IF binding_text IS NULL OR binding_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NOT prefunded_card.treasury_reservation_ready(binding_text::uuid) THEN
    RAISE EXCEPTION 'prefunded treasury refresh required' USING ERRCODE = '42501';
  END IF;
  RETURN prefunded_card.reserve_pre_treasury_guard(command);
END $$;

CREATE FUNCTION prefunded_card.suspend_treasury_binding(binding_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR identity.treasury_binding_id IS NULL OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login THEN
    RAISE EXCEPTION 'prefunded treasury suspend denied' USING ERRCODE = '42501';
  END IF;
  IF NOT binding.enabled THEN RETURN 'already_suspended'; END IF;
  UPDATE prefunded_card.treasury_bindings SET enabled = false WHERE id = binding_id;
  RETURN 'suspended';
END $$;

CREATE FUNCTION prefunded_card.guard_treasury_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE projection_ready boolean;
BEGIN
  IF (OLD.collection_status = 'not_started' AND NEW.collection_status = 'dispatching')
    OR (OLD.transfer_status = 'not_started' AND NEW.transfer_status = 'dispatching') THEN
    IF NOT prefunded_card.treasury_reservation_ready(OLD.treasury_binding_id)
      OR to_regprocedure('prefunded_card.credit_route_dispatch_ready(uuid)') IS NULL THEN
      RAISE EXCEPTION 'prefunded treasury dispatch denied' USING ERRCODE = '42501';
    END IF;
    EXECUTE 'SELECT prefunded_card.credit_route_dispatch_ready($1)'
      INTO projection_ready USING OLD.id;
    IF projection_ready IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'prefunded treasury projection denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_treasury_dispatch_guard
  BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_dispatch();

REVOKE ALL ON FUNCTION prefunded_card.require_treasury_role(text),
  prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint),
  prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint),
  prefunded_card.treasury_reservation_ready(uuid),
  prefunded_card.approve_treasury_replenishment(uuid,uuid,text,text,bigint),
  prefunded_card.reserve_pre_treasury_guard(jsonb), prefunded_card.reserve(jsonb),
  prefunded_card.suspend_treasury_binding(uuid), prefunded_card.guard_treasury_dispatch()
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
