-- Two-person approvals, part 2: the tables, their guards, the action list and
-- the record of which human each login belongs to.
--
-- Deny-all for every API role and for the approver role: rows are reached
-- only through the request functions (part 3) and the approver entry points
-- (part 4). Requests are bound by digest to what was approved, close once,
-- and are never deleted; recorded decisions are append-only.

CREATE TABLE piggyvest_primary.ops_approval_actions (
  action text PRIMARY KEY
    CONSTRAINT ops_approval_actions_action_check CHECK (action ~ '^[a-z][a-z_]{2,62}$'),
  label text NOT NULL
    CONSTRAINT ops_approval_actions_label_check CHECK (label ~ '^[^[:cntrl:]]{3,80}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO piggyvest_primary.ops_approval_actions (action, label) VALUES
  ('transfer_review_resolve', 'Resolve a transfer that is under review'),
  ('obligation_approve', 'Approve paying an outstanding obligation'),
  ('obligation_reject', 'Close an outstanding obligation without paying it'),
  ('treasury_sweep', 'Move Collection wallet money to the Ogabassey bank account'),
  ('support_payout', 'Pay a customer out to their bank account (support)'),
  ('onboarding_adopt', 'Adopt an existing PiggyVest account during onboarding'),
  ('checkout_tender_review_resolve', 'Resolve a checkout wallet payment that is under review'),
  ('goal_residual_review', 'Resolve money left in a savings goal'),
  ('misrouted_interest_resolve', 'Move misrouted main-wallet interest to Ogabassey');

-- Which human each login belongs to. Two database logins are never two
-- humans by themselves: one person has an ops login and an approver login.
-- So the owner records, by hand and never in a migration, the human_id of
-- every login that opens, decides or completes a request (ops, support,
-- worker and approver logins), one row per login. Only the table owner can
-- write it: every API role and the approver role is denied. The two-person
-- rule then compares human_ids: a requester's own approver login cannot
-- approve, one human's two approver logins count once, and whoever completes
-- the action is never one of its approvers. A worker login gets a human_id
-- of its own.
CREATE TABLE piggyvest_primary.ops_login_humans (
  login_oid oid PRIMARY KEY,
  login text NOT NULL
    CONSTRAINT ops_login_humans_login_key UNIQUE
    CONSTRAINT ops_login_humans_login_check CHECK (login ~ '^[^[:cntrl:]]{1,63}$'),
  human_id text NOT NULL
    CONSTRAINT ops_login_humans_human_id_check CHECK (human_id ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE piggyvest_primary.ops_approval_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  action text NOT NULL
    REFERENCES piggyvest_primary.ops_approval_actions (action) ON DELETE RESTRICT,
  subject_table text NOT NULL
    CONSTRAINT ops_approval_requests_subject_table_check
    CHECK (subject_table ~ '^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$'),
  subject_id uuid NOT NULL,
  subject_row_version bigint NOT NULL
    CONSTRAINT ops_approval_requests_row_version_check CHECK (subject_row_version >= 0),
  amount_kobo bigint NOT NULL
    CONSTRAINT ops_approval_requests_amount_check
    CHECK (amount_kobo BETWEEN 0 AND 100000000000000),
  destination jsonb NOT NULL
    CONSTRAINT ops_approval_requests_destination_check
    CHECK (piggyvest_primary.ops_destination_is_valid(destination)),
  digest text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT ops_approval_requests_context_check
    CHECK (piggyvest_primary.ops_context_is_valid(context)),
  requested_by text NOT NULL
    CONSTRAINT ops_approval_requests_requested_by_check
    CHECK (requested_by ~ '^[^[:cntrl:]]{1,63}$'),
  requester_human_id text NOT NULL
    CONSTRAINT ops_approval_requests_requester_human_id_check
    CHECK (requester_human_id ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  state text NOT NULL DEFAULT 'open'
    CONSTRAINT ops_approval_requests_state_check
    CHECK (state IN ('open', 'rejected', 'consumed', 'expired', 'superseded')),
  opened_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz NULL,
  consumed_by text NULL,
  CONSTRAINT ops_approval_requests_digest_check CHECK (
    digest = piggyvest_primary.ops_approval_digest(
      action, subject_table, subject_id, subject_row_version, amount_kobo, destination)),
  CONSTRAINT ops_approval_requests_expiry_check
    CHECK (expires_at = opened_at + interval '24 hours'),
  CONSTRAINT ops_approval_requests_closed_check CHECK ((state = 'open') = (closed_at IS NULL)),
  CONSTRAINT ops_approval_requests_consumed_check
    CHECK ((state = 'consumed') = (consumed_by IS NOT NULL))
);

-- At most one open request per subject and action.
CREATE UNIQUE INDEX ops_approval_requests_one_open_idx
  ON piggyvest_primary.ops_approval_requests (action, subject_table, subject_id)
  WHERE state = 'open';

-- Latest request per subject (also covers the action foreign key).
CREATE INDEX ops_approval_requests_subject_idx
  ON piggyvest_primary.ops_approval_requests (action, subject_table, subject_id, opened_at);

CREATE INDEX ops_approval_requests_open_expiry_idx
  ON piggyvest_primary.ops_approval_requests (expires_at)
  WHERE state = 'open';

-- One decision per approver login, role oid and human per request, so a
-- renamed login or a human's second login cannot decide twice.
CREATE TABLE piggyvest_primary.ops_approvals (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  request_id uuid NOT NULL
    REFERENCES piggyvest_primary.ops_approval_requests (id) ON DELETE RESTRICT,
  approver_login text NOT NULL
    CONSTRAINT ops_approvals_approver_login_check CHECK (approver_login ~ '^[^[:cntrl:]]{1,63}$'),
  approver_role_oid oid NOT NULL,
  approver_human_id text NOT NULL
    CONSTRAINT ops_approvals_approver_human_id_check
    CHECK (approver_human_id ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  decision text NOT NULL
    CONSTRAINT ops_approvals_decision_check CHECK (decision IN ('approve', 'reject')),
  digest text NOT NULL
    CONSTRAINT ops_approvals_digest_check CHECK (digest ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT ops_approvals_request_approver_key UNIQUE (request_id, approver_login),
  CONSTRAINT ops_approvals_request_role_key UNIQUE (request_id, approver_role_oid),
  CONSTRAINT ops_approvals_request_human_key UNIQUE (request_id, approver_human_id)
);

-- Requests only move from open to one closed state; their bound fields never
-- change; nothing is deleted. Recorded decisions are append-only.
CREATE FUNCTION piggyvest_primary.ops_approval_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ops_approval_requests_are_never_deleted' USING ERRCODE = '42501';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'open' THEN
      RAISE EXCEPTION 'ops_approval_request_must_open' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'open' THEN
    RAISE EXCEPTION 'ops_approval_request_is_closed' USING ERRCODE = '42501';
  END IF;
  IF NEW.state NOT IN ('rejected', 'consumed', 'expired', 'superseded')
     OR (NEW.id, NEW.action, NEW.subject_table, NEW.subject_id, NEW.subject_row_version,
         NEW.amount_kobo, NEW.destination, NEW.digest, NEW.context, NEW.requested_by,
         NEW.requester_human_id, NEW.opened_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.id, OLD.action, OLD.subject_table, OLD.subject_id, OLD.subject_row_version,
         OLD.amount_kobo, OLD.destination, OLD.digest, OLD.context, OLD.requested_by,
         OLD.requester_human_id, OLD.opened_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'ops_approval_request_only_closes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION piggyvest_primary.ops_approvals_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ops_approvals_are_append_only' USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER ops_approval_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.ops_approval_requests
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.ops_approval_requests_guard();

CREATE TRIGGER ops_approvals_guard
  BEFORE UPDATE OR DELETE ON piggyvest_primary.ops_approvals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.ops_approvals_guard();

ALTER TABLE piggyvest_primary.ops_approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.ops_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.ops_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.ops_login_humans ENABLE ROW LEVEL SECURITY;

CREATE POLICY ops_approval_actions_deny_all ON piggyvest_primary.ops_approval_actions
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY ops_approval_requests_deny_all ON piggyvest_primary.ops_approval_requests
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY ops_approvals_deny_all ON piggyvest_primary.ops_approvals
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY ops_login_humans_deny_all ON piggyvest_primary.ops_login_humans
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE piggyvest_primary.ops_approval_actions, piggyvest_primary.ops_approval_requests,
  piggyvest_primary.ops_approvals, piggyvest_primary.ops_login_humans
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_approver;

-- The human_id a login belongs to, or NULL when it is not recorded (or the
-- login was renamed since). Granted to nobody.
CREATE FUNCTION piggyvest_primary.ops_human_of(p_login oid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.human_id
  FROM piggyvest_primary.ops_login_humans p
  JOIN pg_catalog.pg_roles r ON r.oid = p.login_oid AND r.rolname::text = p.login
  WHERE p.login_oid = p_login
$$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.ops_approval_requests_guard(),
  piggyvest_primary.ops_approvals_guard(),
  piggyvest_primary.ops_human_of(oid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_primary.ops_approval_requests IS
  'Two-person approval requests bound by digest to (action, subject, row version, amount, destination). Reachable only through the ops approval functions.';
COMMENT ON TABLE piggyvest_primary.ops_approvals IS
  'Append-only approve/reject decisions; approver_login is the deciding SESSION_USER, approver_human_id the human it is recorded under.';
COMMENT ON TABLE piggyvest_primary.ops_login_humans IS
  'Owner-written only: the human_id each ops, support, worker or approver login belongs to. The two-person rule compares human_ids, never logins.';
