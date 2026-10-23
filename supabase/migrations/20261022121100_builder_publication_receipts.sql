-- Private workflow state; the normal owner performs business mutations under RLS.
CREATE TABLE builder_authorization.publication_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 connection_id uuid NOT NULL REFERENCES builder_authorization.connections(id),grant_version bigint NOT NULL,
 merchant_id uuid NOT NULL REFERENCES public.merchants(id),source_version uuid NOT NULL,retry_key uuid NOT NULL,
 config jsonb NOT NULL,destination_url text NOT NULL,policy_namespace text NOT NULL DEFAULT 'baci.website-builder' CHECK(policy_namespace='baci.website-builder'),policy_version int NOT NULL DEFAULT 1 CHECK(policy_version=1),
 effect_digest text NOT NULL CHECK(effect_digest~'^[a-f0-9]{64}$'),input_digest text NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),
 nonce uuid NOT NULL DEFAULT gen_random_uuid(),issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '10 minutes',consumed_at timestamptz,
 UNIQUE(actor_user_id,connection_id,retry_key),CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
CREATE INDEX publication_intents_merchant_idx ON builder_authorization.publication_intents(merchant_id);
CREATE INDEX publication_intents_connection_idx ON builder_authorization.publication_intents(connection_id);
CREATE TABLE builder_authorization.publication_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL UNIQUE REFERENCES builder_authorization.publication_intents(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),connection_id uuid NOT NULL REFERENCES builder_authorization.connections(id),
 merchant_id uuid NOT NULL REFERENCES public.merchants(id),source_version uuid NOT NULL,published_version uuid NOT NULL,
 effect_digest text NOT NULL,policy_namespace text NOT NULL CHECK(policy_namespace='baci.website-builder'),policy_version int NOT NULL CHECK(policy_version=1),
 destination_url text NOT NULL,old_snapshot jsonb NOT NULL,committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,
 UNIQUE(merchant_id,source_version,effect_digest,policy_namespace,policy_version)
);
CREATE INDEX publication_receipts_actor_idx ON builder_authorization.publication_receipts(actor_user_id);
CREATE INDEX publication_receipts_connection_idx ON builder_authorization.publication_receipts(connection_id);
CREATE TABLE builder_authorization.publication_outbox (
 receipt_id uuid PRIMARY KEY REFERENCES builder_authorization.publication_receipts(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),merchant_id uuid NOT NULL REFERENCES public.merchants(id),
 attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),lease_id uuid,lease_expires_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,last_error_code text CHECK(last_error_code IN('DELIVERY_FAILED','SESSION_EXPIRED','SUPERSEDED'))
);
CREATE INDEX publication_outbox_owner_due_idx ON builder_authorization.publication_outbox(actor_user_id,next_attempt_at) WHERE completed_at IS NULL;
CREATE INDEX publication_outbox_merchant_idx ON builder_authorization.publication_outbox(merchant_id);
CREATE TABLE builder_authorization.publication_audit (
 receipt_id uuid PRIMARY KEY REFERENCES builder_authorization.publication_receipts(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),merchant_id uuid NOT NULL REFERENCES public.merchants(id),effect_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX publication_audit_merchant_idx ON builder_authorization.publication_audit(merchant_id);
CREATE INDEX publication_audit_actor_idx ON builder_authorization.publication_audit(actor_user_id);
DO $$DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['publication_intents','publication_receipts','publication_outbox','publication_audit'] LOOP
  EXECUTE format('ALTER TABLE builder_authorization.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON builder_authorization.%I FROM PUBLIC,anon,service_role',tbl);
  EXECUTE format('CREATE POLICY publication_owner ON builder_authorization.%I TO authenticated USING(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid())) WITH CHECK(actor_user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid()))',tbl);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON builder_authorization.publication_intents,builder_authorization.publication_receipts,builder_authorization.publication_outbox TO authenticated;
GRANT SELECT,INSERT ON builder_authorization.publication_audit TO authenticated;
-- The verifier is separate from auth storage and has no business/config/session
-- access. Runtime login/credentials require later explicit staging authorization.
CREATE ROLE baci_builder_publication_verifier NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA builder_authorization TO baci_builder_publication_verifier;
CREATE TABLE builder_authorization.publication_checks (
 id uuid PRIMARY KEY,intent_id uuid NOT NULL REFERENCES builder_authorization.publication_intents(id),receipt_id uuid REFERENCES builder_authorization.publication_receipts(id),
 kind text NOT NULL CHECK(kind IN('render','delivery')),version text NOT NULL,effect_digest text NOT NULL CHECK(effect_digest~'^[a-f0-9]{64}$'),
 verified_at timestamptz NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '2 minutes',
 CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '2 minutes'),CHECK((kind='render' AND receipt_id IS NULL AND version~'^draft:[a-f0-9-]{36}$') OR (kind='delivery' AND receipt_id IS NOT NULL AND version~'^published:[a-f0-9-]{36}$'))
);
CREATE INDEX publication_checks_intent_idx ON builder_authorization.publication_checks(intent_id);
CREATE INDEX publication_checks_receipt_idx ON builder_authorization.publication_checks(receipt_id);
ALTER TABLE builder_authorization.publication_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON builder_authorization.publication_checks FROM PUBLIC,anon,service_role,authenticated,baci_builder_auth_storage;
CREATE POLICY publication_checks_read ON builder_authorization.publication_checks FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM builder_authorization.publication_intents i JOIN public.merchants m ON m.id=i.merchant_id WHERE i.id=intent_id AND i.actor_user_id=auth.uid() AND m.user_id=auth.uid()));
CREATE POLICY publication_checks_insert ON builder_authorization.publication_checks FOR INSERT TO baci_builder_publication_verifier WITH CHECK(verified_at<=clock_timestamp() AND expires_at<=clock_timestamp()+interval '2 minutes' AND effect_digest~'^[a-f0-9]{64}$');
GRANT SELECT ON builder_authorization.publication_checks TO authenticated;
GRANT INSERT ON builder_authorization.publication_checks TO baci_builder_publication_verifier;
