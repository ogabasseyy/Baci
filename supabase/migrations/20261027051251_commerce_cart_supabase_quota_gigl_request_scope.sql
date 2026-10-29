-- Fixed-window cart quotas on the existing database. No cart/customer data
-- is stored here, and the server mints a sixty-second capability per key.
-- The production migration applier owns the transaction and history entry.
CREATE SCHEMA IF NOT EXISTS cart_quota AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA cart_quota FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='commerce_cart_quota') THEN
    CREATE ROLE commerce_cart_quota NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- Preserve the installed guard and all existing worker branches. A quota JWT
-- must not inherit unrelated legacy PUBLIC-executable RPCs through PostgREST.
DO $guard$
DECLARE
  definition text := pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure);
  anchor text := 'IF request_role = ''gigl_tracking_worker'' THEN';
  insertion text := $scope$IF request_role = 'commerce_cart_quota' THEN
    -- commerce_cart_quota_request_scope_v1
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS DISTINCT FROM '/rpc/increment_commerce_cart_quota' THEN
      RAISE EXCEPTION 'Cart quota request is outside its capability scope' USING ERRCODE='42501';
    END IF;
  ELSIF request_role = 'gigl_tracking_worker' THEN$scope$;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r, unnest(r.rolconfig) setting
    WHERE r.rolname='authenticator'
      AND setting='pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('-- commerce_cart_quota_request_scope_v1' IN definition)>0 THEN
    RETURN;
  END IF;
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition,anchor,insertion);
END $guard$;
GRANT commerce_cart_quota TO authenticator;
GRANT USAGE ON SCHEMA public, cart_quota TO commerce_cart_quota;

-- PostgREST supplies these claims only after verifying the signed JWT.
-- Read its request setting directly: the quota role needs no auth-schema grant.
CREATE OR REPLACE FUNCTION cart_quota.claims()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
REVOKE ALL ON FUNCTION cart_quota.claims() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cart_quota.claims() TO commerce_cart_quota;

CREATE TABLE IF NOT EXISTS cart_quota.counters (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  window_ms integer NOT NULL CHECK (window_ms BETWEEN 1000 AND 3600000),
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL
);
ALTER TABLE cart_quota.counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cart_quota.counters FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON cart_quota.counters TO commerce_cart_quota;
CREATE INDEX IF NOT EXISTS cart_quota_counters_expiry_idx ON cart_quota.counters(expires_at);
DROP POLICY IF EXISTS quota_capability_scope ON cart_quota.counters;
CREATE POLICY quota_capability_scope ON cart_quota.counters
  FOR ALL TO commerce_cart_quota
  USING (
    key = (SELECT cart_quota.claims()->>'cart_quota_key')
    AND window_ms = (SELECT (cart_quota.claims()->>'cart_quota_window_ms')::integer)
    AND (SELECT cart_quota.claims()->>'role') = 'commerce_cart_quota'
    AND (SELECT (cart_quota.claims()->>'exp')::numeric) > extract(epoch FROM now())
  )
  WITH CHECK (
    key = (SELECT cart_quota.claims()->>'cart_quota_key')
    AND window_ms = (SELECT (cart_quota.claims()->>'cart_quota_window_ms')::integer)
    AND (SELECT cart_quota.claims()->>'role') = 'commerce_cart_quota'
    AND (SELECT (cart_quota.claims()->>'exp')::numeric) > extract(epoch FROM now())
  );

CREATE OR REPLACE FUNCTION public.increment_commerce_cart_quota()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  claims jsonb := cart_quota.claims();
  counter_key text := claims->>'cart_quota_key';
  window_ms integer;
  counter_count integer;
  counter_expiry timestamptz;
  observed_at timestamptz := clock_timestamp();
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'commerce_cart_quota'
     OR counter_key IS NULL OR counter_key !~ '^[a-f0-9]{64}$'
     OR coalesce(claims->>'cart_quota_window_ms','') !~ '^[0-9]{4,7}$'
     OR coalesce(claims->>'iat','') !~ '^[0-9]{1,12}$'
     OR coalesce(claims->>'exp','') !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'Invalid quota capability' USING ERRCODE='42501';
  END IF;
  window_ms := (claims->>'cart_quota_window_ms')::integer;
  IF window_ms NOT BETWEEN 1000 AND 3600000
     OR (claims->>'exp')::bigint <= extract(epoch FROM observed_at)
     OR (claims->>'iat')::bigint > extract(epoch FROM observed_at)+5
     OR (claims->>'exp')::bigint-(claims->>'iat')::bigint != 60 THEN
    RAISE EXCEPTION 'Invalid quota capability' USING ERRCODE='42501';
  END IF;
  INSERT INTO cart_quota.counters AS current_counter(key,window_ms,count,expires_at)
  VALUES (counter_key,window_ms,1,observed_at + make_interval(secs => window_ms::double precision/1000))
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN current_counter.expires_at <= observed_at THEN 1
                 ELSE least(current_counter.count::bigint+1,2147483647)::integer END,
    expires_at = CASE WHEN current_counter.expires_at <= observed_at THEN excluded.expires_at
                      ELSE current_counter.expires_at END
  RETURNING count,expires_at INTO counter_count,counter_expiry;
  RETURN jsonb_build_object('count',counter_count,'resetTime',floor(extract(epoch FROM counter_expiry)*1000)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.increment_commerce_cart_quota() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_commerce_cart_quota() TO commerce_cart_quota;

-- Maintenance is not a capability of a request token. The existing cron
-- extension runs a bounded batch as its database owner, with no app key.
CREATE OR REPLACE FUNCTION cart_quota.purge_expired(batch_size integer DEFAULT 10000)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE removed integer;
BEGIN
  WITH expired AS (
    SELECT key FROM cart_quota.counters
    WHERE expires_at < statement_timestamp()-interval '1 hour'
    ORDER BY expires_at LIMIT least(greatest(batch_size,1),10000)
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM cart_quota.counters c USING expired e WHERE c.key=e.key;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION cart_quota.purge_expired(integer) FROM PUBLIC, anon, authenticated, service_role, commerce_cart_quota;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('commerce-cart-quota-expiry','*/10 * * * *','SELECT cart_quota.purge_expired(10000)');
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
