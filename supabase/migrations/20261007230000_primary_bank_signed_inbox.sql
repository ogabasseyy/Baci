BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='primary_bank_signed_intake') THEN
    CREATE ROLE primary_bank_signed_intake NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='primary_bank_inbox_worker') THEN
    CREATE ROLE primary_bank_inbox_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
END $$;
CREATE TABLE piggyvest_primary.bank_inbox_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  business_id text NOT NULL CHECK(octet_length(business_id) BETWEEN 1 AND 512),
  environment text NOT NULL CHECK(environment IN ('staging','production')),
  intake_login name NOT NULL CHECK(intake_login='baci_primary_bank_intake'),
  worker_login name NOT NULL CHECK(worker_login='baci_primary_bank_worker'),
  enabled boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL
);
CREATE INDEX primary_bank_authority_merchant_idx ON piggyvest_primary.bank_inbox_authorities(merchant_id);
CREATE TABLE piggyvest_primary.bank_signed_inbox (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  event_id text NOT NULL CHECK(octet_length(event_id) BETWEEN 1 AND 512),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','blocked')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 50),
  claim_token uuid,lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text CHECK(reason IN ('prerequisite','io_retry','financial_conflict','event_conflict','invalid_receipt','attempt_limit')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id),
  CHECK((state='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX primary_bank_inbox_due_idx ON piggyvest_primary.bank_signed_inbox(integration_id,available_at) WHERE state IN ('pending','processing');
CREATE TABLE piggyvest_primary.bank_signed_inbox_conflicts (
  integration_id uuid NOT NULL,event_id text NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,body_digest),
  FOREIGN KEY(integration_id,event_id) REFERENCES piggyvest_primary.bank_signed_inbox(integration_id,event_id)
);
ALTER TABLE piggyvest_primary.bank_inbox_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.bank_signed_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.bank_signed_inbox_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_bank_authority_deny ON piggyvest_primary.bank_inbox_authorities AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_bank_inbox_deny ON piggyvest_primary.bank_signed_inbox AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_bank_conflicts_deny ON piggyvest_primary.bank_signed_inbox_conflicts AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.bank_inbox_authorities,piggyvest_primary.bank_signed_inbox,piggyvest_primary.bank_signed_inbox_conflicts
  FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT USAGE ON SCHEMA piggyvest_primary TO primary_bank_signed_intake,primary_bank_inbox_worker;
CREATE FUNCTION piggyvest_primary.guard_bank_inbox_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (NEW.integration_id,NEW.event_id,NEW.payload,NEW.signature,NEW.body_digest,NEW.created_at)
    IS DISTINCT FROM (OLD.integration_id,OLD.event_id,OLD.payload,OLD.signature,OLD.body_digest,OLD.created_at) THEN
    RAISE EXCEPTION 'immutable bank receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION piggyvest_primary.bank_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable bank evidence' USING ERRCODE='23514'; END $$;
CREATE TRIGGER primary_bank_identity BEFORE UPDATE ON piggyvest_primary.bank_signed_inbox FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_bank_inbox_identity();
CREATE TRIGGER primary_bank_delete BEFORE DELETE OR TRUNCATE ON piggyvest_primary.bank_signed_inbox FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_primary.bank_evidence_immutable();
CREATE TRIGGER primary_bank_conflicts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.bank_signed_inbox_conflicts FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_primary.bank_evidence_immutable();
CREATE FUNCTION piggyvest_primary.bank_role_safe(p_worker boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capability name := CASE WHEN p_worker THEN 'primary_bank_inbox_worker' ELSE 'primary_bank_signed_intake' END;
  allowed text[] := CASE WHEN p_worker THEN ARRAY['bank_role_safe','bank_inbox_readiness','claim_bank_inbox','process_bank_inbox','retry_bank_inbox']
    ELSE ARRAY['bank_role_safe','bank_inbox_readiness','enqueue_bank_inbox'] END;
BEGIN
  RETURN EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname=capability AND NOT role.rolcanlogin AND NOT role.rolsuper
    AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE relation.relkind IN ('r','p','v','m','f','S') AND namespace.nspname NOT IN ('pg_catalog','information_schema')
      AND namespace.nspname NOT LIKE 'pg_%'
      AND CASE WHEN relation.relkind='S' THEN has_sequence_privilege(SESSION_USER,relation.oid,'USAGE,SELECT,UPDATE')
        ELSE has_table_privilege(SESSION_USER,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END)
    AND NOT EXISTS(SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
      WHERE namespace.nspname NOT IN ('pg_catalog','information_schema') AND namespace.nspname NOT LIKE 'pg_%'
        AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')
        AND NOT (namespace.nspname='piggyvest_primary' AND routine.proname=ANY(allowed)
          AND pg_get_function_identity_arguments(routine.oid)=CASE WHEN routine.proname='bank_role_safe' THEN 'p_worker boolean'
            WHEN routine.proname='bank_inbox_readiness' THEN 'p_integration uuid, p_environment text, p_scope jsonb'
            ELSE 'p_integration uuid, p_environment text, p_scope jsonb, p_command jsonb' END))
    AND NOT EXISTS(SELECT 1 FROM unnest(allowed) action WHERE NOT EXISTS(SELECT 1 FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace WHERE namespace.nspname='piggyvest_primary'
        AND routine.proname=action AND has_function_privilege(SESSION_USER,routine.oid,'EXECUTE')));
END $$;
CREATE FUNCTION piggyvest_primary.assert_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_worker boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected_role text := CASE WHEN p_worker THEN 'primary_bank_inbox_worker' ELSE 'primary_bank_signed_intake' END;
BEGIN
  IF NOT piggyvest_primary.bank_role_safe(p_worker) THEN RAISE EXCEPTION 'bank capability privileges unsafe' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope<>jsonb_build_object('merchantId',p_scope->'merchantId','businessId',p_scope->'businessId','expiresAt',p_scope->'expiresAt') THEN
    RAISE EXCEPTION 'invalid bank scope' USING ERRCODE='22023';
  END IF;
  PERFORM binding.integration_id FROM piggyvest_primary.bank_inbox_authorities binding
    JOIN piggyvest_primary.integrations integration ON integration.id=binding.integration_id
    JOIN pg_roles login ON login.rolname=SESSION_USER
    WHERE binding.integration_id=p_integration AND binding.enabled AND integration.enabled
      AND binding.environment=p_environment AND integration.environment=p_environment
      AND binding.merchant_id=integration.merchant_id AND binding.business_id=integration.business_id
      AND binding.merchant_id=(p_scope->>'merchantId')::uuid AND binding.business_id=p_scope->>'businessId'
      AND binding.expires_at=(p_scope->>'expiresAt')::timestamptz AND binding.expires_at>clock_timestamp()
      AND SESSION_USER=CASE WHEN p_worker THEN binding.worker_login ELSE binding.intake_login END
      AND login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolbypassrls AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication
      AND login.rolvaliduntil>clock_timestamp() AND login.rolvaliduntil<=binding.expires_at
      AND pg_has_role(SESSION_USER,expected_role,'MEMBER')
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
        WHERE membership.member=login.oid AND parent.rolname<>expected_role)
    FOR SHARE OF binding,integration;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank inbox authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION piggyvest_primary.bank_inbox_readiness(p_integration uuid,p_environment text,p_scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,SESSION_USER='baci_primary_bank_worker');
  RETURN true;
END $$;
CREATE FUNCTION piggyvest_primary.enqueue_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload bytea; envelope jsonb; fingerprint text; stored piggyvest_primary.bank_signed_inbox%ROWTYPE; owned boolean; ambiguous boolean;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,false);
  IF p_command IS NULL OR p_command<>jsonb_build_object('rawHex',p_command->'rawHex','signature',p_command->'signature')
    OR p_command->>'rawHex' !~ '^[a-f0-9]+$' OR length(p_command->>'rawHex') NOT BETWEEN 2 AND 131072
    OR length(p_command->>'rawHex')%2<>0 OR p_command->>'signature' !~ '^[a-f0-9]{128}$' THEN
    RAISE EXCEPTION 'invalid signed bank bytes' USING ERRCODE='22023';
  END IF;
  payload:=decode(p_command->>'rawHex','hex'); envelope:=convert_from(payload,'UTF8')::jsonb;
  IF envelope->>'eventType' IS DISTINCT FROM 'bank-transfer.inflow.success'
    OR jsonb_typeof(envelope->'eventId') IS DISTINCT FROM 'string' OR octet_length(envelope->>'eventId') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid bank envelope' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent JOIN public.customers customer
    ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE intent.integration_id=p_integration AND intent.merchant_id=(p_scope->>'merchantId')::uuid
      AND intent.provider_wallet_id=envelope->>'pvb_wallet' AND intent.provider_customer_id=envelope->>'customer_id'
      AND intent.state IN ('accepted','verified')) INTO owned;
  SELECT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent WHERE intent.integration_id=p_integration
    AND intent.merchant_id=(p_scope->>'merchantId')::uuid
    AND (intent.provider_wallet_id=envelope->>'pvb_wallet' OR intent.provider_customer_id=envelope->>'customer_id')) INTO ambiguous;
  IF NOT owned AND NOT ambiguous THEN RETURN 'not_handled'; END IF;
  fingerprint:=encode(sha256(payload),'hex');
  INSERT INTO piggyvest_primary.bank_signed_inbox(integration_id,event_id,payload,signature,body_digest,state,reason)
    VALUES(p_integration,envelope->>'eventId',payload,p_command->>'signature',fingerprint,
      CASE WHEN owned THEN 'pending' ELSE 'blocked' END,CASE WHEN owned THEN NULL ELSE 'financial_conflict' END) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN CASE WHEN owned THEN 'accepted' ELSE 'conflict' END; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary.bank_signed_inbox WHERE integration_id=p_integration AND event_id=envelope->>'eventId' FOR UPDATE;
  IF stored.body_digest=fingerprint THEN RETURN CASE WHEN stored.state='blocked' THEN 'conflict' ELSE 'duplicate' END; END IF;
  INSERT INTO piggyvest_primary.bank_signed_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES(p_integration,envelope->>'eventId',fingerprint,payload,p_command->>'signature') ON CONFLICT DO NOTHING;
  UPDATE piggyvest_primary.bank_signed_inbox SET state='blocked',reason='event_conflict',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND event_id=envelope->>'eventId';
  RETURN 'conflict';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.guard_bank_inbox_identity(),piggyvest_primary.bank_evidence_immutable(),
  piggyvest_primary.bank_role_safe(boolean),
  piggyvest_primary.assert_bank_inbox(uuid,text,jsonb,boolean),piggyvest_primary.bank_inbox_readiness(uuid,text,jsonb),
  piggyvest_primary.enqueue_bank_inbox(uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.bank_inbox_readiness(uuid,text,jsonb) TO primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.bank_role_safe(boolean) TO primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.enqueue_bank_inbox(uuid,text,jsonb,jsonb) TO primary_bank_signed_intake;
COMMIT;
