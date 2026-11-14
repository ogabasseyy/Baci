-- Single-use encrypted selfie handoffs. No provider/financial operation is authorized here.
CREATE TABLE oxygen_private.phone_handoffs (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 workflow_id uuid NOT NULL REFERENCES public.oxygen_workflows(id),
 application_reference uuid NOT NULL,
 environment text NOT NULL CHECK(environment IN ('staging','production')),
 ciphertext text NOT NULL CHECK(octet_length(ciphertext) BETWEEN 1 AND 24000),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 consumed_at timestamptz, revoked_at timestamptz
);
CREATE INDEX oxygen_phone_handoffs_workflow_idx ON oxygen_private.phone_handoffs(workflow_id,created_at);
CREATE INDEX oxygen_phone_handoffs_expiry_idx ON oxygen_private.phone_handoffs(expires_at);
ALTER TABLE oxygen_private.phone_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.phone_handoffs FROM PUBLIC,anon,authenticated;

CREATE FUNCTION oxygen_private.phone_handoff(p_operation text,p_workflow_id uuid,p_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.oxygen_workflows%ROWTYPE; b oxygen_private.runtime_bindings%ROWTYPE;
 h oxygen_private.phone_handoffs%ROWTYPE; s jsonb; owner_id uuid; deadline timestamptz;
BEGIN
 IF auth.uid() IS NULL OR p_operation NOT IN ('issue','consume') OR p_hash IS NULL
 OR p_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
 OR octet_length(p_payload::text)>25000 THEN RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='42501'; END IF;
 IF p_operation='consume' THEN
  SELECT workflow_id INTO p_workflow_id FROM oxygen_private.phone_handoffs WHERE token_hash=p_hash;
 END IF;
 -- Consistent workflow -> binding -> provider -> token lock order for issue/redeem races.
 SELECT id,merchant_id,customer_id,order_id,environment,stage INTO w.id,w.merchant_id,w.customer_id,w.order_id,w.environment,w.stage
 FROM public.oxygen_workflows WHERE id=p_workflow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='42501'; END IF;
 SELECT worker_user_id,environment,enabled INTO b.worker_user_id,b.environment,b.enabled
 FROM oxygen_private.runtime_bindings WHERE merchant_id=w.merchant_id FOR SHARE;
 IF NOT FOUND OR NOT coalesce(b.enabled,false) OR b.environment IS DISTINCT FROM w.environment THEN
  RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='42501'; END IF;
 SELECT c.user_id INTO owner_id FROM public.customers c JOIN public.orders o ON o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE o.id=w.order_id AND o.merchant_id=w.merchant_id AND c.id=w.customer_id AND o.cancelled_at IS NULL
 AND o.payment_method='oxygen' FOR SHARE OF o,c;
 IF NOT FOUND OR (p_operation='issue' AND owner_id IS DISTINCT FROM auth.uid())
 OR (p_operation='consume' AND b.worker_user_id IS DISTINCT FROM auth.uid()) THEN
  RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='42501'; END IF;
 SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id=w.id FOR SHARE;
 IF NOT FOUND OR s->>'validated' IS DISTINCT FROM 'true' OR s->>'applicationReference' IS NULL
 OR s->>'bookingReference' IS NOT NULL OR s->'kyc'->>'selfie_status'='DONE'
 OR w.stage IN ('activated','cancelled','expired') THEN RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='40001'; END IF;
 IF p_operation='issue' THEN
  IF p_payload-ARRAY['applicationReference','ciphertext','expiresAt']<>'{}'::jsonb
  OR p_payload->>'applicationReference' IS DISTINCT FROM s->>'applicationReference'
  OR jsonb_typeof(p_payload->'ciphertext') IS DISTINCT FROM 'string'
  OR octet_length(p_payload->>'ciphertext') NOT BETWEEN 1 AND 24000 THEN
   RAISE EXCEPTION 'Invalid handoff' USING ERRCODE='22023'; END IF;
  deadline:=(p_payload->>'expiresAt')::timestamptz;
  IF deadline IS NULL OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '5 minutes' THEN
   RAISE EXCEPTION 'Invalid handoff expiry' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM oxygen_private.phone_handoffs WHERE workflow_id=w.id AND created_at>clock_timestamp()-interval '10 minutes')>=10 THEN
   RAISE EXCEPTION 'Phone handoff rate limited' USING ERRCODE='42501'; END IF;
  UPDATE oxygen_private.phone_handoffs SET revoked_at=clock_timestamp()
   WHERE workflow_id=w.id AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO oxygen_private.phone_handoffs(token_hash,workflow_id,application_reference,environment,ciphertext,expires_at)
   VALUES(p_hash,w.id,(s->>'applicationReference')::uuid,w.environment,p_payload->>'ciphertext',deadline);
  RETURN jsonb_build_object('stored',true);
 END IF;
 IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid handoff' USING ERRCODE='22023'; END IF;
 SELECT token_hash,application_reference,environment,ciphertext,expires_at,consumed_at,revoked_at
 INTO h.token_hash,h.application_reference,h.environment,h.ciphertext,h.expires_at,h.consumed_at,h.revoked_at
 FROM oxygen_private.phone_handoffs WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR h.environment IS DISTINCT FROM w.environment OR h.application_reference::text IS DISTINCT FROM s->>'applicationReference'
 OR h.expires_at<=clock_timestamp() OR h.consumed_at IS NOT NULL OR h.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Phone handoff unavailable' USING ERRCODE='40001'; END IF;
 UPDATE oxygen_private.phone_handoffs SET consumed_at=clock_timestamp() WHERE token_hash=p_hash;
 RETURN jsonb_build_object('workflowId',w.id,'applicationReference',h.application_reference,'environment',h.environment,'ciphertext',h.ciphertext,'expiresAt',h.expires_at);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.phone_handoff(text,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION oxygen_private.phone_handoff(text,uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.oxygen_phone_handoff(p_operation text,p_workflow_id uuid,p_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT oxygen_private.phone_handoff(p_operation,p_workflow_id,p_hash,p_payload);
$$;
REVOKE ALL ON FUNCTION public.oxygen_phone_handoff(text,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_phone_handoff(text,uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
