-- Task 4: bounded source uploads. Definer entry points repeat live owner/grant checks;
-- no caller can insert immutable artifacts, authority metadata or arbitrary tables.
CREATE FUNCTION public.experience_begin_upload(p_merchant uuid,p_connection uuid,p_version bigint,p_manifest jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; f jsonb; total bigint:=0; paths text[]:='{}';
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 IF jsonb_typeof(p_manifest->'files')<>'array' OR jsonb_array_length(p_manifest->'files') NOT BETWEEN 1 AND 128 OR octet_length(p_manifest::text)>98304 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_manifest->'files') LOOP
 IF f->>'path' !~ '^[a-zA-Z0-9_./-]{1,240}$' OR f->>'path' ~ '(^/|(^|/)\.\.?(/|$)|//)' OR lower(f->>'path')=ANY(paths) OR (f->>'bytes')::bigint NOT BETWEEN 0 AND 524288 OR f->>'digest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 paths:=array_append(paths,lower(f->>'path')); total:=total+(f->>'bytes')::bigint;
 END LOOP;
 IF total>4194304 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 -- Serialize quota with every uploader belonging to this merchant.
 PERFORM pg_advisory_xact_lock(hashtextextended('experience-upload:'||p_merchant::text,0));
 IF (SELECT count(*) FROM public.experience_uploads WHERE merchant_id=p_merchant AND expires_at>clock_timestamp() AND finalized_artifact_id IS NULL)>=8 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 INSERT INTO public.experience_uploads(merchant_id,actor_user_id,manifest) VALUES(p_merchant,auth.uid(),p_manifest) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.experience_write_chunk(p_merchant uuid,p_connection uuid,p_version bigint,p_upload uuid,p_path text,p_offset integer,p_bytes text,p_digest text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.experience_uploads; b bytea; old public.experience_chunks; file jsonb;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 SELECT * INTO u FROM public.experience_uploads WHERE id=p_upload AND merchant_id=p_merchant AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LAUNCH_EXPIRED'; END IF;
 IF u.finalized_artifact_id IS NOT NULL OR length(p_bytes)>65536 OR p_bytes !~ '^[a-f0-9]+$' OR length(p_bytes)%2<>0 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 b:=decode(p_bytes,'hex');
 IF octet_length(b) NOT BETWEEN 1 AND 32768 OR encode(sha256(b),'hex')<>p_digest OR p_offset<0 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT value INTO file FROM jsonb_array_elements(u.manifest->'files') WHERE value->>'path'=p_path;
 IF file IS NULL OR p_offset::bigint+octet_length(b)>(file->>'bytes')::bigint THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO old FROM public.experience_chunks WHERE upload_id=p_upload AND path=p_path AND byte_offset=p_offset;
 IF FOUND THEN
 IF old.bytes<>b OR old.digest<>p_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN octet_length(b);
 END IF;
 IF EXISTS(SELECT 1 FROM public.experience_chunks WHERE upload_id=p_upload AND path=p_path AND byte_offset<p_offset+octet_length(b) AND byte_offset+octet_length(bytes)>p_offset) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO public.experience_chunks VALUES(p_merchant,p_upload,p_path,p_offset,b,p_digest);
 RETURN octet_length(b);
END $$;
CREATE FUNCTION public.experience_finalize_upload(p_merchant uuid,p_connection uuid,p_version bigint,p_upload uuid,p_canonical text,p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.experience_uploads; f jsonb; c record; at integer; b bytea; files jsonb:='[]'; m jsonb; a uuid;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 SELECT * INTO u FROM public.experience_uploads WHERE id=p_upload AND merchant_id=p_merchant AND actor_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'LAUNCH_EXPIRED'; END IF;
 IF u.finalized_artifact_id IS NOT NULL THEN RETURN u.finalized_artifact_id; END IF;
 IF octet_length(p_canonical)>25165824 OR encode(sha256(convert_to(p_canonical,'UTF8')),'hex')<>p_digest THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(u.manifest->'files') ORDER BY value->>'path' COLLATE "C" LOOP
 at:=0;b:=''::bytea;
 FOR c IN SELECT byte_offset,bytes,digest FROM public.experience_chunks WHERE upload_id=p_upload AND path=f->>'path' ORDER BY byte_offset LOOP
 IF c.byte_offset<>at OR encode(sha256(c.bytes),'hex')<>c.digest THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 b:=b||c.bytes;at:=at+octet_length(c.bytes);
 END LOOP;
 IF at<>(f->>'bytes')::integer OR encode(sha256(b),'hex')<>f->>'digest' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 files:=files||jsonb_build_array(jsonb_build_object('path',f->>'path','content',convert_from(b,'UTF8')));
 END LOOP;
 m:=jsonb_set(u.manifest->'manifest','{files}',files);
 IF m IS DISTINCT FROM p_canonical::jsonb THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO public.experience_artifacts(merchant_id,source_digest,manifest) VALUES(p_merchant,p_digest,m)
 ON CONFLICT(merchant_id,source_digest) DO NOTHING RETURNING id INTO a;
 IF a IS NULL THEN SELECT id INTO a FROM public.experience_artifacts WHERE merchant_id=p_merchant AND source_digest=p_digest;
 ELSE INSERT INTO public.experience_source_files(merchant_id,artifact_id,path,content) SELECT p_merchant,a,value->>'path',value->>'content' FROM jsonb_array_elements(files); END IF;
 UPDATE public.experience_uploads SET finalized_artifact_id=a WHERE id=p_upload;
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION public.experience_begin_upload(uuid,uuid,bigint,jsonb),public.experience_write_chunk(uuid,uuid,bigint,uuid,text,integer,text,text),public.experience_finalize_upload(uuid,uuid,bigint,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_begin_upload(uuid,uuid,bigint,jsonb),public.experience_write_chunk(uuid,uuid,bigint,uuid,text,integer,text,text),public.experience_finalize_upload(uuid,uuid,bigint,uuid,text,text) TO authenticated;
CREATE TABLE public.experience_source_heads(merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,artifact_id uuid NOT NULL,version bigint NOT NULL,
 FOREIGN KEY(merchant_id,artifact_id) REFERENCES public.experience_artifacts(merchant_id,id));
CREATE INDEX experience_source_heads_artifact_idx ON public.experience_source_heads(artifact_id);
ALTER TABLE public.experience_source_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_source_heads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_source_heads TO authenticated;
CREATE POLICY owner_read ON public.experience_source_heads FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));
CREATE TABLE experience_authorization.source_replays(merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,retry_key uuid NOT NULL,payload text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(merchant_id,retry_key));
ALTER TABLE experience_authorization.source_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.source_replays FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.experience_apply_source(p_merchant uuid,p_connection uuid,p_version bigint,p_artifact uuid,p_base text,p_expected bigint,p_retry uuid,p_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.experience_source_heads; old experience_authorization.source_replays; a public.experience_artifacts; result jsonb;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('experience-source:'||p_merchant::text,0));
 SELECT * INTO old FROM experience_authorization.source_replays WHERE merchant_id=p_merchant AND retry_key=p_retry;
 IF FOUND THEN IF old.payload<>p_payload||':'||p_base||':'||p_expected::text THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN old.result; END IF;
 SELECT * INTO a FROM public.experience_artifacts WHERE merchant_id=p_merchant AND id=p_artifact AND source_digest=p_payload;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO h FROM public.experience_source_heads WHERE merchant_id=p_merchant;
 IF (h.merchant_id IS NULL AND p_expected<>0) OR (h.merchant_id IS NOT NULL AND (h.version<>p_expected OR NOT EXISTS(SELECT 1 FROM public.experience_artifacts WHERE id=h.artifact_id AND source_digest=p_base))) THEN
 result:=jsonb_build_object('artifactId',p_artifact,'version',coalesce(h.version,0),'conflict',true);
 ELSE
 INSERT INTO public.experience_source_heads VALUES(p_merchant,p_artifact,1) ON CONFLICT(merchant_id) DO UPDATE SET artifact_id=p_artifact,version=experience_source_heads.version+1 RETURNING * INTO h;
 result:=jsonb_build_object('artifactId',p_artifact,'version',h.version,'conflict',false);
 END IF;
 INSERT INTO experience_authorization.source_replays VALUES(p_merchant,p_retry,p_payload||':'||p_base||':'||p_expected::text,result);RETURN result;
END $$;
CREATE FUNCTION public.experience_store_asset(p_merchant uuid,p_connection uuid,p_version bigint,p_digest text,p_purpose text,p_mime text,p_alt text,p_bytes text,p_focal jsonb DEFAULT '{"x":0.5,"y":0.5}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b bytea; result uuid; asset text; x double precision; y double precision;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 IF length(p_bytes)>4194304 OR p_bytes !~ '^[a-f0-9]+$' OR length(p_bytes)%2<>0 OR p_purpose NOT IN('design','reference') OR p_focal IS NULL OR jsonb_typeof(p_focal)<>'object' OR (p_focal-'x'-'y')<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 x:=(p_focal->>'x')::double precision;y:=(p_focal->>'y')::double precision;
 IF x IS NULL OR y IS NULL OR NOT (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 b:=decode(p_bytes,'hex');IF encode(sha256(b),'hex')<>p_digest THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 asset:=encode(sha256(convert_to(jsonb_build_object('digest',p_digest,'purpose',p_purpose,'mime',p_mime,'alt',p_alt,'x',x,'y',y)::text,'UTF8')),'hex');
 INSERT INTO public.experience_assets(merchant_id,asset_id,digest,purpose,mime,alt,focal_x,focal_y,bytes) VALUES(p_merchant,asset,p_digest,p_purpose,p_mime,p_alt,x,y,b)
 ON CONFLICT(merchant_id,asset_id) DO NOTHING RETURNING id INTO result;
 IF result IS NULL THEN SELECT id INTO result FROM public.experience_assets WHERE merchant_id=p_merchant AND asset_id=asset AND purpose=p_purpose AND mime=p_mime AND alt=p_alt AND focal_x=x AND focal_y=y AND bytes=b; END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;RETURN jsonb_build_object('assetId',asset,'digest',p_digest);
END $$;
REVOKE ALL ON FUNCTION public.experience_apply_source(uuid,uuid,bigint,uuid,text,bigint,uuid,text),public.experience_store_asset(uuid,uuid,bigint,text,text,text,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_apply_source(uuid,uuid,bigint,uuid,text,bigint,uuid,text),public.experience_store_asset(uuid,uuid,bigint,text,text,text,text,text,jsonb) TO authenticated;
