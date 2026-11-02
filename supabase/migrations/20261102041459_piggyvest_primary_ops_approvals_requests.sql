-- Two-person approvals, part 3: the internal request functions.
--
-- open_ops_request and consume_two_approvals are granted to nobody. Later
-- money commands call them from their own SECURITY DEFINER functions, so the
-- requester recorded here is the SESSION_USER of the ops session that asked.
-- That session must be a dedicated login (ops_login_is_requester), never the
-- owner or a shared API login. Every refusal raises, so the caller's money
-- movement rolls back with it.

CREATE FUNCTION piggyvest_primary.open_ops_request(
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_row_version bigint,
  p_amount_kobo bigint,
  p_destination jsonb,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_digest text;
  v_open_id uuid;
  v_open_digest text;
  v_open_expires timestamptz;
  v_id uuid;
  v_requester_oid oid;
BEGIN
  SELECT r.oid INTO v_requester_oid FROM pg_catalog.pg_roles r WHERE r.rolname = SESSION_USER;
  IF v_requester_oid IS NULL OR NOT piggyvest_primary.ops_login_is_requester(v_requester_oid) THEN
    RAISE EXCEPTION 'ops_approval_invalid_requester' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR NOT EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approval_actions a WHERE a.action = p_action
  ) THEN
    RAISE EXCEPTION 'ops_approval_unknown_action' USING ERRCODE = '22023';
  END IF;
  IF p_subject_table IS NULL
     OR p_subject_table !~ '^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$'
     OR p_subject_id IS NULL
     OR p_row_version IS NULL OR p_row_version < 0
     OR p_amount_kobo IS NULL OR p_amount_kobo NOT BETWEEN 0 AND 100000000000000
     OR NOT piggyvest_primary.ops_destination_is_valid(p_destination)
     OR NOT piggyvest_primary.ops_context_is_valid(COALESCE(p_context, '{}'::jsonb)) THEN
    RAISE EXCEPTION 'ops_approval_invalid_request' USING ERRCODE = '22023';
  END IF;
  v_digest := piggyvest_primary.ops_approval_digest(
    p_action, p_subject_table, p_subject_id, p_row_version, p_amount_kobo, p_destination);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ops-approval:' || p_action || ':' || p_subject_table || ':' || p_subject_id::text, 0));

  SELECT r.id, r.digest, r.expires_at
  INTO v_open_id, v_open_digest, v_open_expires
  FROM piggyvest_primary.ops_approval_requests r
  WHERE r.action = p_action AND r.subject_table = p_subject_table
    AND r.subject_id = p_subject_id AND r.state = 'open'
  FOR UPDATE;
  -- Judge expiry now that the locks are held: the call may have waited.
  v_now := pg_catalog.clock_timestamp();

  -- A rejection is a veto on these exact values: they cannot be asked again.
  -- Only a real change (row version, amount or destination) gives a new
  -- digest that may. Checked after the lock and the row lock above, so a
  -- reject that has just committed is seen.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approval_requests r
    WHERE r.action = p_action AND r.subject_table = p_subject_table
      AND r.subject_id = p_subject_id AND r.state = 'rejected' AND r.digest = v_digest
  ) THEN
    RAISE EXCEPTION 'ops_approval_rejected' USING ERRCODE = 'P0001';
  END IF;

  IF v_open_id IS NOT NULL THEN
    IF v_open_expires > v_now AND v_open_digest = v_digest THEN
      -- Same values, still open: idempotent, keeps its approvals.
      RETURN v_open_id;
    END IF;
    -- Expired, or the subject changed: close it. Its approvals never carry over.
    UPDATE piggyvest_primary.ops_approval_requests
    SET state = CASE WHEN v_open_expires <= v_now THEN 'expired' ELSE 'superseded' END,
        closed_at = v_now
    WHERE id = v_open_id;
  END IF;

  INSERT INTO piggyvest_primary.ops_approval_requests (
    action, subject_table, subject_id, subject_row_version, amount_kobo, destination,
    digest, context, requested_by, opened_at, expires_at
  ) VALUES (
    p_action, p_subject_table, p_subject_id, p_row_version, p_amount_kobo, p_destination,
    v_digest, COALESCE(p_context, '{}'::jsonb), SESSION_USER::text, v_now,
    v_now + interval '24 hours'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION piggyvest_primary.consume_two_approvals(
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_row_version bigint,
  p_amount_kobo bigint,
  p_destination jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_id uuid;
  v_state text;
  v_digest text;
  v_expires timestamptz;
  v_requester text;
  v_approvals integer;
BEGIN
  IF p_action IS NULL OR p_subject_table IS NULL OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'ops_approval_missing' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ops-approval:' || p_action || ':' || p_subject_table || ':' || p_subject_id::text, 0));

  -- The open request if there is one, otherwise the latest closed one (for
  -- a precise refusal).
  SELECT r.id, r.state, r.digest, r.expires_at, r.requested_by
  INTO v_id, v_state, v_digest, v_expires, v_requester
  FROM piggyvest_primary.ops_approval_requests r
  WHERE r.action = p_action AND r.subject_table = p_subject_table AND r.subject_id = p_subject_id
  ORDER BY (r.state = 'open') DESC, r.opened_at DESC, r.id DESC
  LIMIT 1
  FOR UPDATE;
  -- Judge expiry now that the locks are held: the call may have waited.
  v_now := pg_catalog.clock_timestamp();

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ops_approval_missing' USING ERRCODE = 'P0001';
  ELSIF v_state = 'rejected' THEN
    RAISE EXCEPTION 'ops_approval_rejected' USING ERRCODE = 'P0001';
  ELSIF v_state = 'consumed' THEN
    RAISE EXCEPTION 'ops_approval_already_consumed' USING ERRCODE = 'P0001';
  ELSIF v_state <> 'open' THEN
    RAISE EXCEPTION 'ops_approval_missing' USING ERRCODE = 'P0001';
  ELSIF v_expires <= v_now THEN
    RAISE EXCEPTION 'ops_approval_expired' USING ERRCODE = 'P0001';
  END IF;

  -- Recompute from the caller's current values: a changed row version,
  -- amount or destination no longer matches what was approved.
  IF p_row_version IS NULL OR p_amount_kobo IS NULL OR p_destination IS NULL
     OR v_digest IS DISTINCT FROM piggyvest_primary.ops_approval_digest(
       p_action, p_subject_table, p_subject_id, p_row_version, p_amount_kobo, p_destination) THEN
    RAISE EXCEPTION 'ops_approval_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approvals a
    WHERE a.request_id = v_id AND a.decision = 'reject'
  ) THEN
    RAISE EXCEPTION 'ops_approval_rejected' USING ERRCODE = 'P0001';
  END IF;
  -- Whoever completes the action is never one of its approvers.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approvals a
    WHERE a.request_id = v_id AND a.approver_login = SESSION_USER::text
  ) THEN
    RAISE EXCEPTION 'ops_approval_consumer_is_approver' USING ERRCODE = '42501';
  END IF;

  -- Count only approvals that still qualify now: distinct approver logins,
  -- not the requester, made before expiry for this exact digest, whose login
  -- still exists under the same name and is still an approver-only login.
  SELECT pg_catalog.count(DISTINCT a.approver_role_oid)::integer
  INTO v_approvals
  FROM piggyvest_primary.ops_approvals a
  JOIN pg_catalog.pg_roles login
    ON login.oid = a.approver_role_oid AND login.rolname::text = a.approver_login
  WHERE a.request_id = v_id
    AND a.decision = 'approve'
    AND a.digest = v_digest
    AND a.approver_login <> v_requester
    AND a.decided_at < v_expires
    AND piggyvest_primary.ops_login_is_approver(a.approver_role_oid);

  IF v_approvals < 2 THEN
    RAISE EXCEPTION 'ops_approval_insufficient' USING ERRCODE = 'P0001';
  END IF;

  UPDATE piggyvest_primary.ops_approval_requests
  SET state = 'consumed', closed_at = v_now, consumed_by = SESSION_USER::text
  WHERE id = v_id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.open_ops_request(text, text, uuid, bigint, bigint, jsonb, jsonb),
  piggyvest_primary.consume_two_approvals(text, text, uuid, bigint, bigint, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_approver;

COMMENT ON FUNCTION piggyvest_primary.open_ops_request(text, text, uuid, bigint, bigint, jsonb, jsonb) IS
  'Internal. Opens (or returns the identical open) two-person approval request; requester = SESSION_USER, a dedicated login. Values once rejected cannot be asked again. Granted to nobody.';
COMMENT ON FUNCTION piggyvest_primary.consume_two_approvals(text, text, uuid, bigint, bigint, jsonb) IS
  'Internal. Raises unless two distinct approver logins other than the requester approved these exact values within 24h; then consumes the request once. Granted to nobody.';
