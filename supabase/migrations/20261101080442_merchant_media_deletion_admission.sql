CREATE FUNCTION public.claim_merchant_media_deletion(p_merchant_id uuid,p_identity text)
RETURNS TABLE(path text,state text,object_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE object_row record; claim private.merchant_media_delete_claims; source regclass;
 candidate text; referenced boolean; identity_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 IF p_merchant_id IS NULL OR p_identity IS NULL OR length(p_identity) NOT BETWEEN 1 AND 1024
  OR p_identity !~ '^[a-zA-Z0-9_./-]+$' OR strpos(p_identity,'..')>0 THEN
  RAISE EXCEPTION 'media_invalid_identity' USING ERRCODE='22023';
 END IF;
 candidate:=CASE WHEN strpos(p_identity,'/')>0 THEN p_identity ELSE p_merchant_id::text||'/'||p_identity END;
 IF candidate NOT LIKE p_merchant_id::text||'/%' THEN RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 IF NOT private.can_manage_merchant_media(p_merchant_id,candidate) THEN
  RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_identity ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN identity_id:=p_identity::uuid; END IF;
 SELECT o.id,o.name INTO object_row FROM storage.objects o WHERE o.bucket_id='media'
  AND o.name LIKE p_merchant_id::text||'/%'
  AND CASE WHEN identity_id IS NULL THEN o.name=candidate ELSE o.id=identity_id END;
 IF NOT FOUND THEN
  SELECT c.* INTO claim FROM private.merchant_media_delete_claims c WHERE c.merchant_id=p_merchant_id
   AND CASE WHEN identity_id IS NULL THEN c.path=candidate ELSE c.object_id=identity_id END;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_not_found' USING ERRCODE='P0002'; END IF;
  IF NOT private.can_manage_merchant_media(p_merchant_id,claim.path) THEN RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT claim.path,claim.state,claim.object_id; RETURN;
 END IF;
 -- Recheck permission against the resolved path, not the caller's opaque ID.
 IF NOT private.can_manage_merchant_media(p_merchant_id,object_row.name) THEN RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM private.lock_merchant_media_references(ARRAY[p_merchant_id,object_row.id]);
 SELECT c.* INTO claim FROM private.merchant_media_delete_claims c WHERE c.path=object_row.name;
 IF FOUND THEN
  IF claim.state='deleted' OR claim.object_id<>object_row.id THEN RAISE EXCEPTION 'media_reference_check_unavailable' USING ERRCODE='55000'; END IF;
  RETURN QUERY SELECT claim.path,claim.state,claim.object_id; RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='media' AND o.id=object_row.id AND o.name=object_row.name) THEN
  RAISE EXCEPTION 'media_reference_check_unavailable' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['public.merchants','public.products','public.page_configs','public.blog_posts']) name
   WHERE NOT EXISTS(SELECT 1 FROM private.merchant_media_reference_sources s WHERE s.relation=to_regclass(name))) THEN
  RAISE EXCEPTION 'media_reference_check_unavailable' USING ERRCODE='55000';
 END IF;
 -- A missing/disabled guard is a coverage failure, never permission to delete.
 FOR source IN SELECT relation FROM private.merchant_media_reference_sources ORDER BY relation::oid LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=source
     AND t.tgname='merchant_media_reference_guard' AND t.tgenabled IN ('O','A')
     AND t.tgfoid='private.guard_merchant_media_references()'::regprocedure) THEN
   RAISE EXCEPTION 'media_reference_check_unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s row WHERE strpos(private.merchant_media_reference_text(to_jsonb(row)), $1)>0 OR strpos(private.merchant_media_reference_text(to_jsonb(row)), $2)>0)',source)
   INTO referenced USING lower(object_row.name),object_row.id::text;
  IF referenced THEN RAISE EXCEPTION 'media_in_use' USING ERRCODE='23514'; END IF;
 END LOOP;
 INSERT INTO private.merchant_media_delete_claims(path,merchant_id,object_id)
  VALUES(object_row.name,p_merchant_id,object_row.id) RETURNING * INTO claim;
 RETURN QUERY SELECT claim.path,claim.state,claim.object_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_merchant_media_deletion(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_merchant_media_deletion(uuid,text) TO authenticated;

CREATE FUNCTION public.complete_merchant_media_deletion(p_merchant_id uuid,p_path text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_path IS NULL OR p_path NOT LIKE p_merchant_id::text||'/%'
  OR NOT private.can_manage_merchant_media(p_merchant_id,p_path) THEN
  RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='media' AND o.name=p_path) THEN RETURN false; END IF;
 UPDATE private.merchant_media_delete_claims c SET state='deleted',completed_at=coalesce(c.completed_at,clock_timestamp())
 WHERE c.merchant_id=p_merchant_id AND c.path=p_path;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.complete_merchant_media_deletion(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.complete_merchant_media_deletion(uuid,text) TO authenticated;

CREATE FUNCTION public.merchant_media_delete_allowed(p_name text,p_object_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE claim private.merchant_media_delete_claims;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 SELECT c.* INTO claim FROM private.merchant_media_delete_claims c WHERE c.path=p_name AND c.object_id=p_object_id;
 RETURN FOUND AND private.can_manage_merchant_media(claim.merchant_id,p_name);
END $$;
REVOKE ALL ON FUNCTION public.merchant_media_delete_allowed(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.merchant_media_delete_allowed(text,uuid) TO authenticated;

CREATE FUNCTION public.merchant_media_path_writable(p_name text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE merchant uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF split_part(p_name,'/',1) !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN true; END IF;
 merchant:=split_part(p_name,'/',1)::uuid;
 IF NOT private.can_manage_merchant_media(merchant,p_name,true) THEN RETURN false; END IF;
 PERFORM private.lock_merchant_media_references(ARRAY[merchant]);
 -- No claim state is disclosed for another merchant; ordinary Storage policies
 -- still govern upload/update permission independently of this restrictive gate.
 RETURN NOT EXISTS(SELECT 1 FROM private.merchant_media_delete_claims c WHERE c.path=p_name);
END $$;
REVOKE ALL ON FUNCTION public.merchant_media_path_writable(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.merchant_media_path_writable(text) TO authenticated;

-- Restrictive predicates also constrain direct Storage API calls. Only the
-- Storage API removes bytes; no RPC deletes storage.objects rows.
CREATE POLICY merchant_media_claimed_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='media' AND public.merchant_media_delete_allowed(name,id));
CREATE POLICY merchant_media_delete_gate ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'media' OR name !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/'
  OR public.merchant_media_delete_allowed(name,id));
CREATE POLICY merchant_media_insert_gate ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'media' OR public.merchant_media_path_writable(name));
CREATE POLICY merchant_media_update_gate ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'media' OR public.merchant_media_path_writable(name))
 WITH CHECK(bucket_id<>'media' OR public.merchant_media_path_writable(name));

CREATE FUNCTION public.get_merchant_media_deletion_states(p_merchant_id uuid,p_paths text[])
RETURNS TABLE(path text,state text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
 IF auth.uid() IS NULL OR p_merchant_id IS NULL OR p_paths IS NULL OR cardinality(p_paths)>100 THEN
  RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 FOREACH candidate IN ARRAY p_paths LOOP
  IF candidate IS NULL OR candidate NOT LIKE p_merchant_id::text||'/%'
   OR NOT private.can_manage_merchant_media(p_merchant_id,candidate,true) THEN
   RAISE EXCEPTION 'media_forbidden' USING ERRCODE='42501'; END IF;
 END LOOP;
 RETURN QUERY SELECT c.path,c.state FROM private.merchant_media_delete_claims c WHERE c.merchant_id=p_merchant_id AND c.path=ANY(p_paths);
END $$;
REVOKE ALL ON FUNCTION public.get_merchant_media_deletion_states(uuid,text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_merchant_media_deletion_states(uuid,text[]) TO authenticated;
