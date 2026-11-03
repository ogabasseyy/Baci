-- Customer saves and provider completion must both lock workflow before draft.
-- Revoking direct writes prevents callers from acquiring the draft row first.
REVOKE INSERT, UPDATE ON public.oxygen_form_drafts FROM authenticated;

CREATE FUNCTION public.oxygen_save_form_draft(
 p_workflow_id uuid,p_expected_version integer,p_mutation_id uuid,
 p_ciphertext text,p_residential_ciphertext text,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid(); v_stage text; v_version integer; v_owner uuid;
BEGIN
 IF v_user IS NULL OR p_workflow_id IS NULL OR p_mutation_id IS NULL
  OR p_expected_version IS NULL OR p_expected_version<0 OR p_expected_version>=2147483647
  OR p_ciphertext IS NULL OR length(p_ciphertext) NOT BETWEEN 32 AND 16384
  OR p_residential_ciphertext IS NULL OR length(p_residential_ciphertext) NOT BETWEEN 32 AND 16384
  OR p_expires_at IS NULL OR p_expires_at<=now() THEN
  RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='22023';
 END IF;
 -- The customer/order binding is independently checked even though SELECT on
 -- the underlying tables is normally protected by RLS.
 SELECT w.stage INTO v_stage FROM public.oxygen_workflows w
 JOIN public.customers c ON c.id=w.customer_id AND c.merchant_id=w.merchant_id
 JOIN public.orders o ON o.id=w.order_id AND o.customer_id=c.id AND o.merchant_id=c.merchant_id
 WHERE w.id=p_workflow_id AND c.user_id=v_user FOR UPDATE OF w;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF v_stage <> 'application_required' THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='40001'; END IF;
 SELECT version,user_id INTO v_version,v_owner FROM public.oxygen_form_drafts WHERE workflow_id=p_workflow_id FOR UPDATE;
 IF FOUND THEN
  IF v_owner IS DISTINCT FROM v_user OR v_version<>p_expected_version THEN
   RAISE EXCEPTION 'Draft conflict' USING ERRCODE='40001';
  END IF;
  UPDATE public.oxygen_form_drafts SET ciphertext=p_ciphertext,
   residential_ciphertext=p_residential_ciphertext,residential_version=p_expected_version+1,
   version=p_expected_version+1,mutation_id=p_mutation_id,expires_at=p_expires_at
  WHERE workflow_id=p_workflow_id;
 ELSE
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'Draft conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO public.oxygen_form_drafts(workflow_id,user_id,ciphertext,residential_ciphertext,residential_version,version,mutation_id,expires_at)
  VALUES(p_workflow_id,v_user,p_ciphertext,p_residential_ciphertext,1,1,p_mutation_id,p_expires_at);
 END IF;
 RETURN jsonb_build_object('version',p_expected_version+1);
END $$;
REVOKE ALL ON FUNCTION public.oxygen_save_form_draft(uuid,integer,uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.oxygen_save_form_draft(uuid,integer,uuid,text,text,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
