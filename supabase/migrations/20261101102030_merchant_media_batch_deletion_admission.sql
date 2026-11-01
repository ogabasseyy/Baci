-- All claims for one user request are committed together. If any member is
-- referenced, missing or unauthorized, the entire RPC transaction rolls back.
CREATE FUNCTION public.claim_merchant_media_deletion_batch(p_merchant_id uuid,p_identities text[])
RETURNS TABLE(path text,state text,object_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE identity text;
BEGIN
 IF p_identities IS NULL OR cardinality(p_identities) NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'media_invalid_identity' USING ERRCODE='22023';
 END IF;
 FOREACH identity IN ARRAY p_identities LOOP
  RETURN QUERY SELECT claim.path,claim.state,claim.object_id
  FROM public.claim_merchant_media_deletion(p_merchant_id,identity) AS claim;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_merchant_media_deletion_batch(uuid,text[])
 FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_merchant_media_deletion_batch(uuid,text[])
 TO authenticated;
