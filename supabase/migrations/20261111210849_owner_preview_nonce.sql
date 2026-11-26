-- Single-use, short-lived server-to-server preview admission. No user data or tokens.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_owner_preview_nonce') THEN
    CREATE ROLE baci_owner_preview_nonce NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSIF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_owner_preview_nonce'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'UNSAFE_OWNER_PREVIEW_NONCE_ROLE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'baci_owner_preview_nonce'
  ) THEN
    RAISE EXCEPTION 'UNSAFE_OWNER_PREVIEW_NONCE_ROLE';
  END IF;
END $$;
CREATE TABLE builder_authorization.owner_preview_nonces (
  nonce bytea PRIMARY KEY CHECK (octet_length(nonce) = 32),
  expires_at timestamptz NOT NULL
);
CREATE INDEX owner_preview_nonces_expiry_idx ON builder_authorization.owner_preview_nonces(expires_at);
ALTER TABLE builder_authorization.owner_preview_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_authorization.owner_preview_nonces FORCE ROW LEVEL SECURITY;
REVOKE ALL ON builder_authorization.owner_preview_nonces FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA builder_authorization TO baci_owner_preview_nonce;
GRANT INSERT(nonce, expires_at), DELETE, SELECT(expires_at) ON builder_authorization.owner_preview_nonces TO baci_owner_preview_nonce;
CREATE POLICY owner_preview_nonce_insert ON builder_authorization.owner_preview_nonces FOR INSERT TO baci_owner_preview_nonce
  WITH CHECK (expires_at > statement_timestamp() AND expires_at <= statement_timestamp() + interval '90 seconds');
CREATE POLICY owner_preview_nonce_expired_read ON builder_authorization.owner_preview_nonces FOR SELECT TO baci_owner_preview_nonce
  USING (expires_at <= statement_timestamp());
CREATE POLICY owner_preview_nonce_expired_delete ON builder_authorization.owner_preview_nonces FOR DELETE TO baci_owner_preview_nonce
  USING (expires_at <= statement_timestamp());
