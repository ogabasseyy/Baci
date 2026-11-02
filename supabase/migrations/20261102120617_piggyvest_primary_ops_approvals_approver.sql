-- Two-person approvals, part 4: what a human approver can do.
--
-- An approver signs in with their own LOGIN and can run exactly two
-- functions: list the open requests they may decide, and record one approve
-- or reject decision on one of them. The decision must repeat the amount and
-- digest the approver was shown, so it is bound to what they saw. Who
-- decided is always SESSION_USER and the human_id the owner registered it
-- under; nothing in the call can name an approver.

-- Display helpers. A destination shows its bank code and last four
-- characters first, then the requester's label last and in quotes, so a
-- label can never push the real account off the line or pose as it.
CREATE FUNCTION piggyvest_primary.ops_format_naira(p_amount_kobo bigint)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '₦' || pg_catalog.to_char(p_amount_kobo / 100, 'FM999,999,999,999,990')
    || '.' || pg_catalog.lpad((p_amount_kobo % 100)::text, 2, '0')
$$;

CREATE FUNCTION piggyvest_primary.ops_mask_destination(p_destination jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_destination ->> 'kind'
    WHEN 'none' THEN 'No payout destination'
    WHEN 'bank_account' THEN
      'Bank ' || (p_destination ->> 'bank_code') || ' ••••'
        || pg_catalog.right(p_destination ->> 'ref', 4)
        || COALESCE(' "' || (p_destination ->> 'label') || '"', '')
    WHEN 'wallet' THEN
      'Wallet ••••' || pg_catalog.right(p_destination ->> 'ref', 4)
        || COALESCE(' "' || (p_destination ->> 'label') || '"', '')
    ELSE 'Unrecognised destination'
  END
$$;

CREATE FUNCTION piggyvest_approvals.list_open_ops_requests()
RETURNS TABLE (
  request_id uuid,
  action text,
  label text,
  subject text,
  amount_kobo bigint,
  amount_naira text,
  destination text,
  reason text,
  requested_by text,
  opened_at timestamptz,
  expires_at timestamptz,
  approvals integer,
  decided_by_you boolean,
  digest text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_login text := SESSION_USER::text;
  v_login_oid oid;
  v_human_id text;
BEGIN
  SELECT r.oid INTO v_login_oid FROM pg_catalog.pg_roles r WHERE r.rolname::text = v_login;
  IF v_login_oid IS NULL OR NOT piggyvest_primary.ops_login_is_approver(v_login_oid) THEN
    RAISE EXCEPTION 'ops_approval_not_an_approver' USING ERRCODE = '42501';
  END IF;
  v_human_id := piggyvest_primary.ops_human_of(v_login_oid);
  IF v_human_id IS NULL THEN
    RAISE EXCEPTION 'ops_approval_unregistered_login' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    q.id,
    q.action,
    a.label,
    q.subject_table || ':' || q.subject_id::text,
    q.amount_kobo,
    piggyvest_primary.ops_format_naira(q.amount_kobo),
    piggyvest_primary.ops_mask_destination(q.destination),
    q.context ->> 'reason',
    q.requested_by,
    q.opened_at,
    q.expires_at,
    (SELECT pg_catalog.count(DISTINCT d.approver_human_id)::integer
     FROM piggyvest_primary.ops_approvals d
     WHERE d.request_id = q.id AND d.decision = 'approve'),
    EXISTS (SELECT 1 FROM piggyvest_primary.ops_approvals d
            WHERE d.request_id = q.id
              AND (d.approver_role_oid = v_login_oid OR d.approver_human_id = v_human_id)),
    q.digest
  FROM piggyvest_primary.ops_approval_requests q
  JOIN piggyvest_primary.ops_approval_actions a ON a.action = q.action
  WHERE q.state = 'open'
    AND q.expires_at > pg_catalog.clock_timestamp()
    AND q.requested_by <> v_login
    AND q.requester_human_id <> v_human_id
  ORDER BY q.expires_at, q.id;
END
$$;

CREATE FUNCTION piggyvest_approvals.approve_ops_request(
  p_request_id uuid,
  p_decision text,
  p_amount_kobo bigint,
  p_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_login text := SESSION_USER::text;
  v_login_oid oid;
  v_state text;
  v_digest text;
  v_amount bigint;
  v_expires timestamptz;
  v_requester text;
  v_requester_human_id text;
  v_human_id text;
  v_approvals integer;
BEGIN
  SELECT r.oid INTO v_login_oid FROM pg_catalog.pg_roles r WHERE r.rolname::text = v_login;
  IF v_login_oid IS NULL OR NOT piggyvest_primary.ops_login_is_approver(v_login_oid) THEN
    RAISE EXCEPTION 'ops_approval_not_an_approver' USING ERRCODE = '42501';
  END IF;
  v_human_id := piggyvest_primary.ops_human_of(v_login_oid);
  IF v_human_id IS NULL THEN
    RAISE EXCEPTION 'ops_approval_unregistered_login' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'ops_approval_invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT q.state, q.digest, q.amount_kobo, q.expires_at, q.requested_by, q.requester_human_id
  INTO v_state, v_digest, v_amount, v_expires, v_requester, v_requester_human_id
  FROM piggyvest_primary.ops_approval_requests q
  WHERE q.id = p_request_id
  FOR UPDATE;
  -- The row lock is held: read the clock only now, because the call may have
  -- waited for it. The expiry test, decided_at and closed_at all use it.
  v_now := pg_catalog.clock_timestamp();

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'ops_approval_missing' USING ERRCODE = 'P0001';
  ELSIF v_state <> 'open' THEN
    RAISE EXCEPTION 'ops_approval_closed' USING ERRCODE = 'P0001';
  ELSIF v_expires <= v_now THEN
    RAISE EXCEPTION 'ops_approval_expired' USING ERRCODE = 'P0001';
  ELSIF v_requester = v_login OR v_requester_human_id = v_human_id THEN
    RAISE EXCEPTION 'ops_approval_requester_cannot_approve' USING ERRCODE = '42501';
  ELSIF p_digest IS DISTINCT FROM v_digest OR p_amount_kobo IS DISTINCT FROM v_amount THEN
    RAISE EXCEPTION 'ops_approval_confirmation_mismatch' USING ERRCODE = '22023';
  END IF;

  -- The request row lock serialises decisions, so this check cannot race.
  -- One decision per login and per human.
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approvals d
    WHERE d.request_id = p_request_id
      AND (d.approver_login = v_login OR d.approver_role_oid = v_login_oid
        OR d.approver_human_id = v_human_id)
  ) THEN
    RAISE EXCEPTION 'ops_approval_already_decided' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO piggyvest_primary.ops_approvals (
    request_id, approver_login, approver_role_oid, approver_human_id, decision, digest, decided_at
  ) VALUES (p_request_id, v_login, v_login_oid, v_human_id, p_decision, v_digest, v_now);

  IF p_decision = 'reject' THEN
    UPDATE piggyvest_primary.ops_approval_requests
    SET state = 'rejected', closed_at = v_now
    WHERE id = p_request_id;
  END IF;

  SELECT pg_catalog.count(DISTINCT d.approver_human_id)::integer INTO v_approvals
  FROM piggyvest_primary.ops_approvals d
  WHERE d.request_id = p_request_id AND d.decision = 'approve';

  RETURN pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
    'decision', p_decision,
    'approvals', v_approvals,
    'state', CASE WHEN p_decision = 'reject' THEN 'rejected' ELSE 'open' END);
END
$$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.ops_format_naira(bigint),
  piggyvest_primary.ops_mask_destination(jsonb),
  piggyvest_approvals.list_open_ops_requests(),
  piggyvest_approvals.approve_ops_request(uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  piggyvest_approvals.list_open_ops_requests(),
  piggyvest_approvals.approve_ops_request(uuid, text, bigint, text)
  TO piggyvest_primary_approver;

COMMENT ON FUNCTION piggyvest_approvals.list_open_ops_requests() IS
  'Approver logins only: open, unexpired requests that no login of the caller''s human opened, with plain label, naira amount, masked destination and expiry.';
COMMENT ON FUNCTION piggyvest_approvals.approve_ops_request(uuid, text, bigint, text) IS
  'Approver logins only: records one approve or reject by SESSION_USER after the caller repeats the amount and digest shown. Any reject closes the request.';
