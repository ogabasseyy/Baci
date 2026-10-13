\set ON_ERROR_STOP on
\set authpass `echo "$ISOLATED_AUTH_DB_PASSWORD"`
\set restpass `echo "$ISOLATED_REST_DB_PASSWORD"`
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER USER authenticator WITH PASSWORD :'restpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'authpass';
ALTER SCHEMA auth OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;
SELECT format('ALTER ROLE %I NOLOGIN', rolname)
FROM pg_roles
WHERE rolname IN ('pgbouncer', 'supabase_functions_admin', 'supabase_storage_admin')
\gexec
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
