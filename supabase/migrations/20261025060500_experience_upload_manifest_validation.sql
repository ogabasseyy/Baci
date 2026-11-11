-- Fail-closed manifest validation before byte-quota arithmetic.
-- Append-only replacement retains existing owner/grant checks and RPC grants.
CREATE OR REPLACE FUNCTION public.experience_begin_upload(p_merchant uuid,p_connection uuid,p_version bigint,p_manifest jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; f jsonb; total bigint:=0; paths text[]:='{}';
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'object' OR jsonb_typeof(p_manifest->'files') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF jsonb_typeof(p_manifest->'files')<>'array' OR jsonb_array_length(p_manifest->'files') NOT BETWEEN 1 AND 128 OR octet_length(p_manifest::text)>98304 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_manifest->'files') LOOP
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'bytes') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'digest') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF f->>'bytes' !~ '^(0|[1-9][0-9]{0,5})$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
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
