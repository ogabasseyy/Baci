BEGIN;

CREATE TABLE prefunded_card.treasury_identities (
  treasury_binding_id uuid PRIMARY KEY REFERENCES prefunded_card.treasury_bindings(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  expected_business_id text COLLATE "C" NOT NULL,
  source_wallet_id text COLLATE "C" NOT NULL,
  authorized_login name NOT NULL,
  opening_available_kobo bigint NOT NULL CHECK (opening_available_kobo BETWEEN 1 AND 9007199254740991),
  provisioned_by name NOT NULL,
  provisioned_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (pg_catalog.octet_length(expected_business_id) BETWEEN 1 AND 512),
  CHECK (pg_catalog.octet_length(source_wallet_id) BETWEEN 1 AND 512)
);

CREATE TABLE prefunded_card.treasury_snapshots (
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_identities(treasury_binding_id),
  evidence_id text COLLATE "C" NOT NULL,
  sequence_number bigint NOT NULL CHECK (sequence_number BETWEEN 1 AND 9007199254740991),
  observed_at timestamptz NOT NULL,
  available_kobo bigint NOT NULL CHECK (available_kobo BETWEEN 0 AND 9007199254740991),
  verified_by name NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (treasury_binding_id, evidence_id),
  UNIQUE (treasury_binding_id, sequence_number),
  CHECK (pg_catalog.octet_length(evidence_id) BETWEEN 1 AND 128)
);

CREATE TABLE prefunded_card.treasury_replenishments (
  id uuid PRIMARY KEY,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_identities(treasury_binding_id),
  snapshot_evidence_id text COLLATE "C" NOT NULL,
  reconciliation_reference text COLLATE "C" NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  approved_by name NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (treasury_binding_id, snapshot_evidence_id),
  UNIQUE (treasury_binding_id, reconciliation_reference),
  FOREIGN KEY (treasury_binding_id, snapshot_evidence_id)
    REFERENCES prefunded_card.treasury_snapshots(treasury_binding_id, evidence_id),
  CHECK (pg_catalog.octet_length(reconciliation_reference) BETWEEN 1 AND 128)
);

ALTER TABLE prefunded_card.treasury_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.treasury_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.treasury_replenishments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.treasury_identities, prefunded_card.treasury_snapshots,
  prefunded_card.treasury_replenishments FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_treasury_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'prefunded treasury identity immutable' USING ERRCODE = '42501';
END $$;

CREATE FUNCTION prefunded_card.guard_treasury_binding_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'prefunded treasury binding identity immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.enabled IS DISTINCT FROM NEW.enabled THEN
    IF OLD.enabled AND NOT NEW.enabled
      AND (to_jsonb(NEW) - ARRAY['enabled']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['enabled']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'prefunded treasury binding reenable denied' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['verified_available_kobo', 'reserved_kobo', 'consumed_kobo', 'verified_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['verified_available_kobo', 'reserved_kobo', 'consumed_kobo', 'verified_at']) THEN
    RAISE EXCEPTION 'prefunded treasury binding identity immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_treasury_identity_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_identities
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_identity_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_identities
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_snapshot_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_snapshots
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_replenishment_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_replenishments
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_binding_identity_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_bindings
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_binding_identity();
CREATE TRIGGER prefunded_treasury_snapshot_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_replenishment_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_replenishments
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_binding_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_binding_identity();

REVOKE ALL ON FUNCTION prefunded_card.guard_treasury_identity(),
  prefunded_card.guard_treasury_binding_identity() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE prefunded_card.treasury_identities IS
  'Staging-only immutable owner-provisioned business/source/worker identity. It is not inferred from a customer or a provider balance.';
COMMENT ON TABLE prefunded_card.treasury_snapshots IS
  'Verifier-only immutable observations. A snapshot may block spending but never increases company float.';
COMMENT ON TABLE prefunded_card.treasury_replenishments IS
  'Explicit independently verified and deduplicated float replenishments. Every row reconciles exactly one observed snapshot delta.';
COMMIT;
