-- Separate, disabled-until-provisioned builder OAuth storage. No login credential.
CREATE SCHEMA builder_authorization;
REVOKE ALL ON SCHEMA builder_authorization FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='baci_builder_auth_storage') THEN
  CREATE ROLE baci_builder_auth_storage NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
 ELSE
  RAISE EXCEPTION 'builder_auth_role_already_exists_requires_review';
 END IF;
END $$;
GRANT USAGE ON SCHEMA builder_authorization TO authenticated, baci_builder_auth_storage;
CREATE TABLE builder_authorization.connections (
 id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider_grant_id text NOT NULL UNIQUE,
 grant_version bigint NOT NULL DEFAULT 1 CHECK (grant_version BETWEEN 1 AND 9007199254740991),
 scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 3 AND scopes <@ ARRAY['storefront.read','storefront.write','storefront.publish']::text[] AND 'storefront.read'=ANY(scopes)),
 allowed_merchant_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(allowed_merchant_ids)<=1),
 allow_create_store boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked','expired')),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='revoked')=(revoked_at IS NOT NULL))
);
CREATE INDEX builder_connections_actor_idx ON builder_authorization.connections(actor_user_id);
ALTER TABLE builder_authorization.connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_provider_connections ON builder_authorization.connections TO baci_builder_auth_storage USING(true) WITH CHECK(true);
CREATE POLICY builder_owner_connection_select ON builder_authorization.connections FOR SELECT TO authenticated USING(actor_user_id=(SELECT auth.uid()));
CREATE POLICY builder_owner_connection_update ON builder_authorization.connections FOR UPDATE TO authenticated USING(actor_user_id=(SELECT auth.uid())) WITH CHECK(actor_user_id=(SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON builder_authorization.connections TO baci_builder_auth_storage;
GRANT SELECT ON builder_authorization.connections TO authenticated;
-- SELECT FOR UPDATE in SECURITY INVOKER commerce RPCs needs UPDATE privileges.
-- The trigger below admits only revocation or materializing pre-consented ownership.
GRANT UPDATE(status,revoked_at,grant_version,allowed_merchant_ids) ON builder_authorization.connections TO authenticated;
CREATE FUNCTION builder_authorization.guard_owner_connection_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user='baci_builder_auth_storage' THEN RETURN NEW; END IF;
 IF auth.uid() IS DISTINCT FROM OLD.actor_user_id THEN
  RAISE EXCEPTION 'builder_connection_denied';
 END IF;
 IF NEW.allowed_merchant_ids IS NOT DISTINCT FROM OLD.allowed_merchant_ids THEN
  IF NEW.status<>'revoked' OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'builder_connection_denied'; END IF;
  NEW.grant_version:=OLD.grant_version+1;
 ELSE
  IF OLD.status<>'active' OR OLD.expires_at<=now() OR NOT OLD.allow_create_store OR cardinality(OLD.allowed_merchant_ids)<>0 OR cardinality(NEW.allowed_merchant_ids)<>1
   OR NEW.status IS DISTINCT FROM OLD.status OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.grant_version<>OLD.grant_version
   OR NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=NEW.allowed_merchant_ids[1] AND m.user_id=auth.uid())
  THEN RAISE EXCEPTION 'builder_connection_denied'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION builder_authorization.guard_owner_connection_update() FROM PUBLIC;
CREATE TRIGGER builder_owner_connection_update BEFORE UPDATE ON builder_authorization.connections FOR EACH ROW EXECUTE FUNCTION builder_authorization.guard_owner_connection_update();
CREATE TABLE builder_authorization.sessions (
 connection_id uuid PRIMARY KEY REFERENCES builder_authorization.connections(id) ON DELETE CASCADE,
 sealed jsonb NOT NULL,
 refresh_started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE builder_authorization.provider_records (
 model text NOT NULL, id text NOT NULL, grant_id text, uid text, user_code text,
 payload jsonb NOT NULL, consumed bigint, expires_at timestamptz NOT NULL,
 PRIMARY KEY(model,id)
);
CREATE INDEX builder_provider_grant_idx ON builder_authorization.provider_records(grant_id);
CREATE INDEX builder_provider_uid_idx ON builder_authorization.provider_records(model,uid);
CREATE INDEX builder_provider_code_idx ON builder_authorization.provider_records(model,user_code);
CREATE TABLE builder_authorization.transactions (
 id_hash text PRIMARY KEY, browser_hash text NOT NULL, sealed jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
ALTER TABLE builder_authorization.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_authorization.provider_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_authorization.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY builder_provider_sessions ON builder_authorization.sessions TO baci_builder_auth_storage USING(true) WITH CHECK(true);
CREATE POLICY builder_provider_records ON builder_authorization.provider_records TO baci_builder_auth_storage USING(true) WITH CHECK(true);
CREATE POLICY builder_provider_transactions ON builder_authorization.transactions TO baci_builder_auth_storage USING(true) WITH CHECK(true);
REVOKE ALL ON ALL TABLES IN SCHEMA builder_authorization FROM PUBLIC, anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON builder_authorization.sessions,builder_authorization.provider_records,builder_authorization.transactions TO baci_builder_auth_storage;
COMMENT ON SCHEMA builder_authorization IS 'Private broker storage; never add to PostgREST exposed schemas. Provider role has no commerce grants or authenticated membership. No secrets are provisioned by this migration.';
-- Normal Baci cookie/bearer session can disconnect its own link without vault access.
CREATE FUNCTION public.disconnect_builder_connection(p_connection_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_status text;
BEGIN
 SELECT status INTO current_status FROM builder_authorization.connections WHERE id=p_connection_id AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF current_status='revoked' THEN RETURN true; END IF;
 UPDATE builder_authorization.connections SET status='revoked',revoked_at=now() WHERE id=p_connection_id AND actor_user_id=auth.uid();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.disconnect_builder_connection(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.disconnect_builder_connection(uuid) TO authenticated;

DO $$ BEGIN
 IF pg_has_role('baci_builder_auth_storage','authenticated','MEMBER') OR EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege('baci_builder_auth_storage',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 ) THEN RAISE EXCEPTION 'builder_auth_role_has_commerce_authority'; END IF;
END $$;
CREATE FUNCTION public.list_builder_connections()
RETURNS TABLE(connection_id uuid,scopes text[],status text,expires_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT id,scopes,CASE WHEN status='active' AND expires_at<=now() THEN 'expired' ELSE status END,expires_at,created_at
 FROM builder_authorization.connections WHERE actor_user_id=auth.uid()
 ORDER BY created_at DESC,id LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.list_builder_connections() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_builder_connections() TO authenticated;
