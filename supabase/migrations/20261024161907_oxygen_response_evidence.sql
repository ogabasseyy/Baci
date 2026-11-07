-- Worker-only encrypted response projection. No request bodies, OTPs or signatures.
CREATE TABLE oxygen_private.response_evidence (
 command_id uuid NOT NULL REFERENCES oxygen_private.commands(id),
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 20),
 ciphertext text NOT NULL CHECK(octet_length(ciphertext) BETWEEN 40 AND 32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 PRIMARY KEY(command_id,sequence)
);
CREATE INDEX oxygen_response_evidence_expiry_idx ON oxygen_private.response_evidence(expires_at);
ALTER TABLE oxygen_private.response_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.response_evidence FROM PUBLIC,anon,authenticated;
CREATE FUNCTION oxygen_private.response_evidence_access(p_operation text,p_command_id uuid,p_sequence integer DEFAULT 1,p_ciphertext text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE merchant uuid; command_status text; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT w.merchant_id,c.status INTO merchant,command_status
 FROM oxygen_private.commands c JOIN public.oxygen_workflows w ON w.id=c.workflow_id
 JOIN oxygen_private.runtime_bindings b ON b.merchant_id=w.merchant_id
 WHERE c.id=p_command_id AND w.environment='staging' AND b.environment='staging'
 AND b.enabled AND b.worker_user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation='record' THEN
  IF command_status<>'executing' OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 20 OR p_ciphertext IS NULL
   OR octet_length(p_ciphertext) NOT BETWEEN 40 AND 32768
   OR p_ciphertext !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  THEN RAISE EXCEPTION 'Evidence unavailable'; END IF;
  INSERT INTO oxygen_private.response_evidence(command_id,sequence,ciphertext) VALUES(p_command_id,p_sequence,p_ciphertext) ON CONFLICT DO NOTHING;
  DELETE FROM oxygen_private.response_evidence e USING oxygen_private.commands c,public.oxygen_workflows w
  WHERE e.command_id=c.id AND c.workflow_id=w.id AND w.merchant_id=merchant AND e.expires_at<=now();
  RETURN jsonb_build_object('recorded',true);
 ELSIF p_operation='read' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'ciphertext',ciphertext,'createdAt',created_at,'expiresAt',expires_at) ORDER BY sequence),'[]'::jsonb)
  INTO result FROM oxygen_private.response_evidence WHERE command_id=p_command_id AND expires_at>now();
  RETURN result;
 END IF;
 RAISE EXCEPTION 'Evidence unavailable';
END $$;
REVOKE ALL ON FUNCTION oxygen_private.response_evidence_access(text,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.response_evidence_access(text,uuid,integer,text) TO authenticated;
CREATE FUNCTION public.oxygen_response_evidence(p_operation text,p_command_id uuid,p_sequence integer DEFAULT 1,p_ciphertext text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.response_evidence_access(p_operation,p_command_id,p_sequence,p_ciphertext);
$$;
REVOKE ALL ON FUNCTION public.oxygen_response_evidence(text,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_response_evidence(text,uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
