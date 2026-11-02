-- Two-person approvals for PiggyVest operations (owner default 8).
--
-- One mechanism for every ops decision that moves or releases money. A
-- request is bound to (action, subject row, row version, amount,
-- destination) through a digest. It resolves only after two different
-- people approve it, neither of whom opened it, within 24 hours, and only
-- once. Identity is the database SESSION_USER: each human approver signs in
-- with their own LOGIN, which the owner creates by hand (never in a
-- migration) and grants piggyvest_primary_approver and nothing else. No
-- function takes an approver name, so identity cannot be passed in.
--
-- Part 1 (this file): the approver role, its schema and the validation
-- helpers. Part 2: the tables (..._tables.sql). Part 3: the internal request
-- functions (..._requests.sql). Part 4: the approver entry points
-- (..._approver.sql).
--
-- Dark: nothing calls the request functions yet and no approver login exists.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_approver') THEN
    CREATE ROLE piggyvest_primary_approver
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_primary_approver'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'piggyvest_primary_approver exists with unexpected attributes';
  END IF;
END
$$;

-- Approver entry points live in their own schema, so an approver login can
-- reach exactly those functions and nothing in piggyvest_primary. Plain
-- CREATE on purpose: an existing schema of this name would be unexpected and
-- could hold objects an approver login could reach, so the migration fails.
CREATE SCHEMA piggyvest_approvals;
REVOKE ALL ON SCHEMA piggyvest_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_approvals TO piggyvest_primary_approver;

-- Destination contract: {"kind":"none"}; a bank account
-- {"kind":"bank_account","bank_code":"<3-6 digits>","ref":"<10-digit NUBAN>"};
-- or a PiggyVest wallet {"kind":"wallet","ref":"<provider wallet id>"}. An
-- optional "label" is shown to approvers after the masked destination. It is
-- a plain name: letters, single spaces and & . , ' - only, so it can carry no
-- digits (no account number) and cannot imitate a masked destination. No
-- other key is allowed.
CREATE FUNCTION piggyvest_primary.ops_destination_is_valid(p_destination jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_destination IS NULL OR pg_catalog.jsonb_typeof(p_destination) <> 'object' THEN false
    WHEN p_destination ? 'label' AND NOT (
      pg_catalog.jsonb_typeof(p_destination -> 'label') = 'string'
      AND (p_destination ->> 'label') ~ '^[A-Za-z][A-Za-z&.,'' -]{0,59}$'
      AND (p_destination ->> 'label') !~ '  '
      AND (p_destination ->> 'label') !~ ' $') THEN false
    WHEN p_destination ->> 'kind' = 'none' THEN p_destination = '{"kind":"none"}'::jsonb
    WHEN p_destination ->> 'kind' = 'bank_account' THEN
      (SELECT pg_catalog.bool_and(k IN ('kind', 'ref', 'bank_code', 'label'))
       FROM pg_catalog.jsonb_object_keys(p_destination) AS k)
      AND pg_catalog.jsonb_typeof(p_destination -> 'ref') = 'string'
      AND (p_destination ->> 'ref') ~ '^[0-9]{10}$'
      AND pg_catalog.jsonb_typeof(p_destination -> 'bank_code') = 'string'
      AND (p_destination ->> 'bank_code') ~ '^[0-9]{3,6}$'
    WHEN p_destination ->> 'kind' = 'wallet' THEN
      (SELECT pg_catalog.bool_and(k IN ('kind', 'ref', 'label'))
       FROM pg_catalog.jsonb_object_keys(p_destination) AS k)
      AND pg_catalog.jsonb_typeof(p_destination -> 'ref') = 'string'
      AND (p_destination ->> 'ref') ~ '^[A-Za-z0-9._:-]{8,64}$'
    ELSE false
  END
$$;

-- Requester context: a small object. Only "reason" is read (shown to
-- approvers); every other key, such as "approver", is stored and ignored.
CREATE FUNCTION piggyvest_primary.ops_context_is_valid(p_context jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_context IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_context) = 'object'
    AND pg_catalog.octet_length(p_context::text) <= 4096
    AND (NOT p_context ? 'reason' OR (
      pg_catalog.jsonb_typeof(p_context -> 'reason') = 'string'
      AND (p_context ->> 'reason') ~ '^[^[:cntrl:]]{1,200}$'))
$$;

-- What an approval is bound to. jsonb text output is canonical, so equal
-- inputs always give the same digest.
CREATE FUNCTION piggyvest_primary.ops_approval_digest(
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_row_version bigint,
  p_amount_kobo bigint,
  p_destination jsonb
)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'v', 1,
      'action', p_action,
      'subject_table', p_subject_table,
      'subject_id', p_subject_id,
      'row_version', p_row_version,
      'amount_kobo', p_amount_kobo,
      'destination', p_destination)::text,
    'UTF8')), 'hex')
$$;

-- An approver login: can log in, holds no elevated attribute, and has exactly
-- one direct membership, piggyvest_primary_approver without ADMIN OPTION. So
-- it holds no engine, ops, support or service role. The approver role itself
-- must be a plain NOLOGIN role that is a member of nothing.
CREATE FUNCTION piggyvest_primary.ops_login_is_approver(p_login oid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS login
    JOIN pg_catalog.pg_roles AS approver ON approver.rolname = 'piggyvest_primary_approver'
    WHERE login.oid = p_login
      AND login.rolcanlogin
      AND NOT (login.rolsuper OR login.rolcreaterole OR login.rolcreatedb
        OR login.rolreplication OR login.rolbypassrls)
      AND NOT (approver.rolcanlogin OR approver.rolsuper OR approver.rolcreaterole
        OR approver.rolcreatedb OR approver.rolreplication OR approver.rolbypassrls)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS m
        WHERE m.member = login.oid AND m.roleid = approver.oid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS m
        WHERE m.member = login.oid AND (m.roleid <> approver.oid OR m.admin_option))
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = approver.oid)
  )
$$;

-- A requester login: a dedicated LOGIN for one person or one worker. It holds
-- no elevated attribute (so never the migration owner or a superuser) and is
-- not a shared API login: not a member of anon, authenticated or
-- service_role, as PostgREST's authenticator is. Otherwise every request
-- opened through that login would carry the same requester, and the rule
-- that the requester never approves would mean nothing.
CREATE FUNCTION piggyvest_primary.ops_login_is_requester(p_login oid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS login
    WHERE login.oid = p_login
      AND login.rolcanlogin
      AND NOT (login.rolsuper OR login.rolcreaterole OR login.rolcreatedb
        OR login.rolreplication OR login.rolbypassrls)
      AND NOT pg_catalog.pg_has_role(login.oid, 'anon', 'MEMBER')
      AND NOT pg_catalog.pg_has_role(login.oid, 'authenticated', 'MEMBER')
      AND NOT pg_catalog.pg_has_role(login.oid, 'service_role', 'MEMBER')
  )
$$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.ops_destination_is_valid(jsonb),
  piggyvest_primary.ops_context_is_valid(jsonb),
  piggyvest_primary.ops_approval_digest(text, text, uuid, bigint, bigint, jsonb),
  piggyvest_primary.ops_login_is_approver(oid),
  piggyvest_primary.ops_login_is_requester(oid)
  FROM PUBLIC, anon, authenticated, service_role;
