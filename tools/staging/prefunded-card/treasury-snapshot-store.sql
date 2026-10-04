BEGIN;

CREATE TABLE prefunded_card.treasury_verifier_bindings (
  login_name name PRIMARY KEY,
  treasury_binding_id uuid NOT NULL UNIQUE REFERENCES prefunded_card.treasury_identities(treasury_binding_id),
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (login_name = 'prefunded_snapshot_verifier')
);
ALTER TABLE prefunded_card.treasury_verifier_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_treasury_verifier_deny ON prefunded_card.treasury_verifier_bindings
  USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.treasury_verifier_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prefunded_treasury_verifier_immutable BEFORE UPDATE OR DELETE
  ON prefunded_card.treasury_verifier_bindings FOR EACH ROW
  EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_verifier_no_truncate BEFORE TRUNCATE
  ON prefunded_card.treasury_verifier_bindings FOR EACH STATEMENT
  EXECUTE FUNCTION prefunded_card.guard_treasury_identity();

CREATE FUNCTION prefunded_card.assert_snapshot_verifier_binding(p_binding uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE verifier_role pg_roles%ROWTYPE; capability_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO verifier_role FROM pg_roles WHERE rolname=session_user;
  SELECT * INTO capability_role FROM pg_roles WHERE rolname='prefunded_treasury_verifier';
  IF session_user<>'prefunded_snapshot_verifier' OR p_binding IS NULL
    OR verifier_role.oid IS NULL OR capability_role.oid IS NULL
    OR NOT verifier_role.rolcanlogin OR verifier_role.rolinherit
    OR verifier_role.rolsuper OR verifier_role.rolbypassrls OR verifier_role.rolcreaterole
    OR verifier_role.rolcreatedb OR verifier_role.rolreplication
    OR capability_role.rolcanlogin OR capability_role.rolsuper OR capability_role.rolbypassrls
    OR capability_role.rolcreaterole OR capability_role.rolcreatedb OR capability_role.rolreplication
    OR (SELECT count(*) FROM pg_auth_members WHERE member=verifier_role.oid)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=verifier_role.oid
      AND roleid=capability_role.oid AND NOT admin_option AND NOT inherit_option AND NOT set_option)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=capability_role.oid OR roleid=verifier_role.oid)
    OR has_function_privilege(session_user,
      'prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'treasury verifier identity refused' USING ERRCODE='42501';
  END IF;
  PERFORM verifier.treasury_binding_id FROM prefunded_card.treasury_verifier_bindings verifier
    JOIN prefunded_card.treasury_bindings binding ON binding.id=verifier.treasury_binding_id
    JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=binding.id
    JOIN piggyvest_staging.integrations registry ON registry.id=binding.integration_id
    WHERE verifier.login_name=session_user AND verifier.treasury_binding_id=p_binding
      AND verifier.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
      AND verifier.expires_at>clock_timestamp() AND binding.enabled AND registry.enabled
      AND registry.expected_provider_account_id=binding.expected_business_id
      AND binding.integration_id=identity.integration_id AND binding.merchant_id=identity.merchant_id
      AND binding.expected_business_id=identity.expected_business_id
      AND binding.source_wallet_id=identity.source_wallet_id
      AND binding.authorized_login=identity.authorized_login AND binding.currency='NGN'
    FOR SHARE OF verifier;
  IF NOT FOUND THEN RAISE EXCEPTION 'treasury verifier binding refused' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION prefunded_card.verify_snapshot_binding(
  p_binding uuid,p_system text,p_business text,p_source text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM prefunded_card.assert_snapshot_verifier_binding(p_binding);
  IF p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_identities
      WHERE treasury_binding_id=p_binding AND expected_business_id=p_business AND source_wallet_id=p_source) THEN
    RAISE EXCEPTION 'treasury verifier scope refused' USING ERRCODE='42501';
  END IF;
  RETURN 'verified';
END $$;

CREATE FUNCTION prefunded_card.snapshot_database_time(p_binding uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM prefunded_card.assert_snapshot_verifier_binding(p_binding);
  RETURN clock_timestamp();
END $$;

CREATE FUNCTION prefunded_card.record_scoped_treasury_snapshot(
  p_binding uuid,p_evidence text,p_observed timestamptz,p_available bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored prefunded_card.treasury_snapshots%ROWTYPE; next_sequence bigint;
BEGIN
  PERFORM prefunded_card.assert_snapshot_verifier_binding(p_binding);
  PERFORM id FROM prefunded_card.treasury_bindings WHERE id=p_binding FOR UPDATE;
  PERFORM prefunded_card.assert_snapshot_verifier_binding(p_binding);
  IF p_observed IS NULL OR p_observed NOT BETWEEN clock_timestamp()-interval '30 seconds'
    AND clock_timestamp()+interval '30 seconds' OR p_evidence IS NULL
    OR octet_length(p_evidence) NOT BETWEEN 1 AND 128
    OR p_available IS NULL OR p_available NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'treasury observation refused' USING ERRCODE='22023';
  END IF;
  SELECT * INTO stored FROM prefunded_card.treasury_snapshots
    WHERE treasury_binding_id=p_binding AND evidence_id=p_evidence;
  IF FOUND THEN
    IF stored.observed_at=p_observed AND stored.available_kobo=p_available
      AND stored.verified_by=session_user THEN RETURN 'duplicate'; END IF;
    RAISE EXCEPTION 'treasury observation conflict' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(max(sequence_number),0)+1 INTO next_sequence
    FROM prefunded_card.treasury_snapshots WHERE treasury_binding_id=p_binding;
  RETURN prefunded_card.record_treasury_snapshot(p_binding,p_evidence,next_sequence,p_observed,p_available);
END $$;

REVOKE ALL ON FUNCTION prefunded_card.assert_snapshot_verifier_binding(uuid),
  prefunded_card.verify_snapshot_binding(uuid,text,text,text),prefunded_card.snapshot_database_time(uuid),
  prefunded_card.record_scoped_treasury_snapshot(uuid,text,timestamptz,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA prefunded_card TO prefunded_snapshot_verifier;
GRANT EXECUTE ON FUNCTION prefunded_card.verify_snapshot_binding(uuid,text,text,text),
  prefunded_card.snapshot_database_time(uuid),prefunded_card.record_scoped_treasury_snapshot(uuid,text,timestamptz,bigint)
  TO prefunded_snapshot_verifier;

COMMIT;
