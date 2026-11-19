-- Include-only helper for quiz_identity_device_caps.sql (no BEGIN/ROLLBACK): the suite loads it with \ir.
-- The helper is called after SET ROLE, so it needs an explicit GRANT (new functions are
-- not executable by other roles by default).

CREATE FUNCTION pg_temp.quiz_device_proof(
  p_attempt_id uuid,
  p_device_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_action constant text := 'bind_quiz_attempt_device_v1';
  v_issued_at text := pg_catalog.to_char(
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_payload_hash constant text := pg_catalog.repeat('0', 64);
  v_scope constant text := 'quiz_phase1a';
  v_subject_id text := 'device:' || pg_catalog.encode(
    extensions.digest(p_attempt_id::text || ':' || p_device_hash, 'sha256'),
    'hex'
  );
  v_version constant text := 'quiz-rpc-proof:v1';
  v_canonical text;
BEGIN
  v_canonical := v_version || E'\n' || v_scope || E'\n' || v_action || E'\n'
    || v_subject_id || E'\n' || p_user_id::text || E'\n' || v_issued_at
    || E'\n' || v_payload_hash;

  RETURN pg_catalog.jsonb_build_object(
    'action', v_action,
    'issued_at', v_issued_at,
    'payload_hash', v_payload_hash,
    'proof_id', 'device-cap-test-' || p_attempt_id::text,
    'scope', v_scope,
    'signature', pg_catalog.encode(
      extensions.hmac(v_canonical, 'quiz-device-cap-test-secret', 'sha256'),
      'hex'
    ),
    'subject_id', v_subject_id,
    'user_id', p_user_id,
    'version', v_version
  );
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.quiz_device_proof(uuid, text, uuid) TO PUBLIC; -- called after SET ROLE
