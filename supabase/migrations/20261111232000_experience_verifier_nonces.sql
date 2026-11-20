-- Single-use verifier requests contain no user data or bearer tokens.
CREATE TABLE experience_authorization.verifier_nonces (
  nonce bytea PRIMARY KEY CHECK (octet_length(nonce) = 32),
  expires_at timestamptz NOT NULL
);
CREATE INDEX verifier_nonces_expiry_idx ON experience_authorization.verifier_nonces(expires_at);
ALTER TABLE experience_authorization.verifier_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_authorization.verifier_nonces FORCE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.verifier_nonces FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT(nonce, expires_at), DELETE, SELECT(expires_at) ON experience_authorization.verifier_nonces TO baci_experience_verifier;
CREATE POLICY verifier_nonce_insert ON experience_authorization.verifier_nonces FOR INSERT TO baci_experience_verifier
  WITH CHECK (expires_at > statement_timestamp() AND expires_at <= statement_timestamp() + interval '90 seconds');
CREATE POLICY verifier_nonce_expired_read ON experience_authorization.verifier_nonces FOR SELECT TO baci_experience_verifier
  USING (expires_at <= statement_timestamp());
CREATE POLICY verifier_nonce_expired_delete ON experience_authorization.verifier_nonces FOR DELETE TO baci_experience_verifier
  USING (expires_at <= statement_timestamp());
