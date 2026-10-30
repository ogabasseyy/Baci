-- Private, account-wide address attempt ledger. Nothing is enabled by this migration.
-- Rollback: revoke address_budget_reserver membership and retain all history.
CREATE SCHEMA IF NOT EXISTS address_budget AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA address_budget FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF position('address_provider_budget_request_scope_v1' IN
    pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Address budget request guard must be installed first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS address_budget.authorizations (
  provider text NOT NULL CHECK (provider IN ('google','geoapify')),
  period_key text NOT NULL,
  account_reference text NOT NULL CHECK (length(account_reference) BETWEEN 1 AND 200),
  credential_hashes text[] NOT NULL CHECK (
    array_length(credential_hashes,1) BETWEEN 1 AND 10
    AND array_to_string(credential_hashes,',') ~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$'),
  consumed_baseline integer NOT NULL CHECK (consumed_baseline >= 0),
  baseline_expires_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  last_legacy_dispatch_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 500),
  PRIMARY KEY (provider,period_key)
);
CREATE TABLE IF NOT EXISTS address_budget.reservations (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google','geoapify')),
  period_key text NOT NULL,
  request_kind text NOT NULL CHECK (request_kind IN ('autocomplete','details')),
  reserved_at timestamptz NOT NULL,
  FOREIGN KEY (provider,period_key) REFERENCES address_budget.authorizations(provider,period_key)
);
CREATE INDEX IF NOT EXISTS address_budget_reservations_window_idx
  ON address_budget.reservations(provider,period_key,reserved_at);
ALTER TABLE address_budget.authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE address_budget.reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON address_budget.authorizations, address_budget.reservations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION address_budget.claims()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
REVOKE ALL ON FUNCTION address_budget.claims() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public, address_budget TO address_budget_reserver;
GRANT EXECUTE ON FUNCTION address_budget.claims() TO address_budget_reserver;
GRANT SELECT ON address_budget.authorizations TO address_budget_reserver;
GRANT SELECT, INSERT ON address_budget.reservations TO address_budget_reserver;
CREATE POLICY address_budget_authorization_read ON address_budget.authorizations FOR SELECT TO address_budget_reserver
  USING (provider = (SELECT address_budget.claims()->>'address_provider'));
CREATE POLICY address_budget_reservation_read ON address_budget.reservations FOR SELECT TO address_budget_reserver
  USING (provider = (SELECT address_budget.claims()->>'address_provider'));
CREATE POLICY address_budget_reservation_insert ON address_budget.reservations FOR INSERT TO address_budget_reserver
  WITH CHECK (
    provider = (SELECT address_budget.claims()->>'address_provider')
    AND id::text = (SELECT address_budget.claims()->>'address_reservation_id')
    AND request_kind = (SELECT address_budget.claims()->>'address_request_kind')
  );

-- Owner-only initialization/update. Evidence asserts verified account-wide allowance,
-- a finite bound for other consumers, and the last possible legacy dispatch.
-- No request role can configure or renew allowances, change accounts or reset history.
CREATE OR REPLACE FUNCTION address_budget.authorize_provider(
  selected_provider text, selected_account text, accepted_hashes text[], baseline integer,
  evidence text, legacy_dispatch_ended_at timestamptz, expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '1000ms' AS $$
DECLARE
  observed_at timestamptz;
  selected_period text;
  period_end timestamptz;
  debt_expiry timestamptz;
  previous address_budget.authorizations%ROWTYPE;
BEGIN
  IF selected_provider NOT IN ('google','geoapify') THEN RAISE EXCEPTION 'Invalid address provider'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('address-budget:' || selected_provider,0));
  observed_at := clock_timestamp();
  IF baseline IS NULL OR baseline < 0 OR baseline > 2147483647
    OR selected_account IS NULL OR length(selected_account) NOT BETWEEN 1 AND 200
    OR evidence IS NULL OR length(evidence) NOT BETWEEN 1 AND 500
    OR accepted_hashes IS NULL OR array_length(accepted_hashes,1) IS NULL
    OR array_length(accepted_hashes,1) NOT BETWEEN 1 AND 10 OR array_position(accepted_hashes,NULL) IS NOT NULL
    OR array_to_string(accepted_hashes,',') !~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$'
    OR legacy_dispatch_ended_at IS NULL OR legacy_dispatch_ended_at > observed_at
    OR expires_at IS NULL OR expires_at <= observed_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'Invalid verified address allowance';
  END IF;
  selected_period := CASE WHEN selected_provider='google'
    THEN to_char(observed_at AT TIME ZONE 'America/Los_Angeles','YYYY-MM') ELSE 'rolling-24h' END;
  period_end := CASE WHEN selected_provider='google'
    THEN (date_trunc('month',observed_at AT TIME ZONE 'America/Los_Angeles') + interval '1 month') AT TIME ZONE 'America/Los_Angeles'
    ELSE observed_at + interval '24 hours' END;
  IF expires_at > period_end THEN RAISE EXCEPTION 'Authorization exceeds verified period'; END IF;
  debt_expiry := CASE WHEN selected_provider='google' THEN period_end
    ELSE greatest(observed_at,legacy_dispatch_ended_at) + interval '24 hours' END;
  SELECT a.provider,a.period_key,a.account_reference,a.credential_hashes,a.consumed_baseline,
    a.baseline_expires_at,a.verified_at,a.last_legacy_dispatch_at,a.valid_until,a.evidence_reference
    INTO previous FROM address_budget.authorizations a
    WHERE a.provider=selected_provider AND a.period_key=selected_period;
  IF FOUND AND (previous.account_reference <> selected_account
    OR (baseline < previous.consumed_baseline AND
      (selected_provider <> 'geoapify' OR previous.baseline_expires_at > observed_at))) THEN
    RAISE EXCEPTION 'Account cannot change and baseline cannot decrease';
  END IF;
  INSERT INTO address_budget.authorizations(provider,period_key,account_reference,credential_hashes,
    consumed_baseline,baseline_expires_at,verified_at,last_legacy_dispatch_at,valid_until,evidence_reference)
  VALUES(selected_provider,selected_period,selected_account,accepted_hashes,baseline,debt_expiry,
    observed_at,legacy_dispatch_ended_at,expires_at,evidence)
  ON CONFLICT(provider,period_key) DO UPDATE SET
    credential_hashes=excluded.credential_hashes, consumed_baseline=excluded.consumed_baseline,
    baseline_expires_at=greatest(address_budget.authorizations.baseline_expires_at,excluded.baseline_expires_at),
    verified_at=excluded.verified_at,last_legacy_dispatch_at=excluded.last_legacy_dispatch_at,
    valid_until=excluded.valid_until,evidence_reference=excluded.evidence_reference;
END $$;
REVOKE ALL ON FUNCTION address_budget.authorize_provider(text,text,text[],integer,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, address_budget_reserver;

CREATE OR REPLACE FUNCTION public.reserve_address_provider_request()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '1000ms' AS $$
DECLARE
  claims jsonb := address_budget.claims();
  selected_provider text := claims->>'address_provider';
  kind text := claims->>'address_request_kind';
  selected_id uuid;
  observed_at timestamptz;
  selected_period text;
  period_end timestamptz;
  allowance address_budget.authorizations%ROWTYPE;
  occupied bigint;
  latest timestamptz;
  ceiling integer;
  retry_ms integer;
  dispatch_before timestamptz;
BEGIN
  IF current_user <> 'address_budget_reserver' OR claims->>'role' IS DISTINCT FROM 'address_budget_reserver'
    OR selected_provider IS NULL OR selected_provider NOT IN ('google','geoapify')
    OR kind IS NULL OR kind NOT IN ('autocomplete','details') OR (selected_provider='geoapify' AND kind <> 'autocomplete')
    OR coalesce(claims->>'address_credential_hash','') !~ '^[a-f0-9]{64}$'
    OR coalesce(claims->>'address_reservation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(claims->>'iat','') !~ '^[0-9]{1,12}$'
    OR coalesce(claims->>'exp','') !~ '^[0-9]{1,12}$'
    OR (claims->>'exp')::bigint - (claims->>'iat')::bigint <> 60 THEN
    RAISE EXCEPTION 'Invalid address reservation capability' USING ERRCODE='42501';
  END IF;
  selected_id := (claims->>'address_reservation_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('address-budget:' || selected_provider,0));
  observed_at := clock_timestamp();
  IF (claims->>'iat')::bigint > extract(epoch FROM observed_at)+5
    OR (claims->>'exp')::bigint <= extract(epoch FROM observed_at)+10 THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  selected_period := CASE WHEN selected_provider='google'
    THEN to_char(observed_at AT TIME ZONE 'America/Los_Angeles','YYYY-MM') ELSE 'rolling-24h' END;
  period_end := CASE WHEN selected_provider='google'
    THEN (date_trunc('month',observed_at AT TIME ZONE 'America/Los_Angeles') + interval '1 month') AT TIME ZONE 'America/Los_Angeles'
    ELSE observed_at + interval '24 hours' END;
  SELECT a.provider,a.period_key,a.account_reference,a.credential_hashes,a.consumed_baseline,
    a.baseline_expires_at,a.verified_at,a.last_legacy_dispatch_at,a.valid_until,a.evidence_reference
    INTO allowance FROM address_budget.authorizations a
    WHERE a.provider=selected_provider AND a.period_key=selected_period;
  IF NOT FOUND OR allowance.valid_until <= observed_at + interval '10 seconds'
    OR allowance.verified_at > observed_at
    OR NOT ((claims->>'address_credential_hash') = ANY(allowance.credential_hashes)) THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF EXISTS(SELECT 1 FROM address_budget.reservations WHERE id=selected_id) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;
  SELECT count(*),max(reserved_at) INTO occupied,latest FROM address_budget.reservations
    WHERE provider=selected_provider AND period_key=selected_period
      AND (selected_provider='google' OR reserved_at > observed_at - interval '24 hours');
  occupied := occupied + CASE WHEN allowance.baseline_expires_at > observed_at THEN allowance.consumed_baseline ELSE 0 END;
  ceiling := CASE WHEN selected_provider='geoapify' THEN 2800 WHEN kind='autocomplete' THEN 4400 ELSE 4500 END;
  IF occupied >= ceiling THEN RETURN jsonb_build_object('status','limit_reached'); END IF;
  IF selected_provider='geoapify' AND latest > observed_at - interval '250 milliseconds' THEN
    retry_ms := ceil(250 - extract(epoch FROM observed_at-latest)*1000)::integer;
    RETURN jsonb_build_object('status','paced','retryAfterMs',greatest(1,least(250,retry_ms)));
  END IF;
  dispatch_before := least(observed_at + interval '3 seconds',
    allowance.valid_until - interval '10 seconds',period_end - interval '10 seconds');
  IF dispatch_before <= observed_at THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  INSERT INTO address_budget.reservations(id,provider,period_key,request_kind,reserved_at)
    VALUES(selected_id,selected_provider,selected_period,kind,observed_at)
    ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  RETURN jsonb_build_object('status','reserved','reservationId',selected_id,
    'dispatchBefore',floor(extract(epoch FROM dispatch_before)*1000)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.reserve_address_provider_request() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_address_provider_request() TO address_budget_reserver;
-- Normal production deployment observes the staged hook before this grant.
GRANT address_budget_reserver TO authenticator;
NOTIFY pgrst, 'reload schema';

