-- Checkpoint B / Task 3: private storage only. No publication lifecycle or public reads.
CREATE SCHEMA experience_authorization;
REVOKE ALL ON SCHEMA experience_authorization FROM PUBLIC,anon,service_role;
GRANT USAGE ON SCHEMA experience_authorization TO authenticated;
-- A still-valid JWT does not revive a deleted/revoked upstream session.
CREATE FUNCTION public.experience_owner_readable(p_merchant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant AND m.user_id=auth.uid())
 AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=nullif(auth.jwt()->>'session_id','')::uuid AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>clock_timestamp()))
$$;
REVOKE ALL ON FUNCTION public.experience_owner_readable(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_owner_readable(uuid) TO authenticated;
CREATE FUNCTION public.experience_require_owner(p_merchant uuid,p_connection uuid DEFAULT NULL,p_version bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM auth.sessions WHERE id=nullif(auth.jwt()->>'session_id','')::uuid AND user_id=auth.uid() FOR SHARE;
 IF NOT FOUND OR NOT public.experience_owner_readable(p_merchant) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF p_connection IS NOT NULL THEN PERFORM public.builder_lock_connection(p_connection,p_version,p_merchant,false);
 ELSIF p_version IS NOT NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.experience_require_owner(uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_require_owner(uuid,uuid,bigint) TO authenticated;

CREATE TABLE public.experience_artifacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'), manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(merchant_id,id), UNIQUE(merchant_id,source_digest));
CREATE INDEX experience_artifacts_merchant_idx ON public.experience_artifacts(merchant_id);
ALTER TABLE public.experience_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_artifacts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_artifacts TO authenticated;
CREATE POLICY owner_read ON public.experience_artifacts FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_source_files (merchant_id uuid NOT NULL, artifact_id uuid NOT NULL, path text NOT NULL CHECK(length(path) BETWEEN 1 AND 240), content text NOT NULL CHECK(octet_length(content)<=524288),
 PRIMARY KEY(artifact_id,path), FOREIGN KEY(merchant_id,artifact_id) REFERENCES public.experience_artifacts(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_source_files_merchant_idx ON public.experience_source_files(merchant_id);
ALTER TABLE public.experience_source_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_source_files FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_source_files TO authenticated;
CREATE POLICY owner_read ON public.experience_source_files FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, artifact_id uuid NOT NULL,
 retry_key uuid NOT NULL, source_digest text NOT NULL, attempt_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','verified','finalized','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 UNIQUE(merchant_id,id), UNIQUE(merchant_id,retry_key), FOREIGN KEY(merchant_id,artifact_id) REFERENCES public.experience_artifacts(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_jobs_merchant_idx ON public.experience_jobs(merchant_id);
ALTER TABLE public.experience_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_jobs TO authenticated;
CREATE POLICY owner_read ON public.experience_jobs FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_builds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, job_id uuid NOT NULL,
 build_digest text NOT NULL CHECK(build_digest ~ '^[a-f0-9]{64}$'), output_manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(merchant_id,id), UNIQUE(job_id),
 FOREIGN KEY(merchant_id,job_id) REFERENCES public.experience_jobs(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_builds_merchant_idx ON public.experience_builds(merchant_id);
ALTER TABLE public.experience_builds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_builds FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_builds TO authenticated;
CREATE POLICY owner_read ON public.experience_builds FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 asset_id text NOT NULL CHECK(asset_id ~ '^[a-z0-9-]{1,80}$'), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(purpose IN('reference','design')), mime text NOT NULL CHECK(mime IN('image/png','font/woff2')),
 alt text NOT NULL CHECK(length(alt)<=500), focal_x double precision NOT NULL DEFAULT 0.5 CHECK(focal_x BETWEEN 0 AND 1), focal_y double precision NOT NULL DEFAULT 0.5 CHECK(focal_y BETWEEN 0 AND 1), bytes bytea NOT NULL CHECK(octet_length(bytes)<=2097152), UNIQUE(merchant_id,asset_id));
CREATE INDEX experience_assets_merchant_idx ON public.experience_assets(merchant_id);
ALTER TABLE public.experience_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_assets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_assets TO authenticated;
CREATE POLICY owner_read ON public.experience_assets FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, job_id uuid NOT NULL,
 attempt_nonce uuid NOT NULL, build_digest text NOT NULL CHECK(build_digest ~ '^[a-f0-9]{64}$'), receipt_digest text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(job_id,attempt_nonce),
 FOREIGN KEY(merchant_id,job_id) REFERENCES public.experience_jobs(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_evidence_merchant_idx ON public.experience_evidence(merchant_id);
ALTER TABLE public.experience_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_evidence TO authenticated;
CREATE POLICY owner_read ON public.experience_evidence FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, build_id uuid NOT NULL,
 effect_digest text NOT NULL, UNIQUE(merchant_id,id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_approvals_merchant_idx ON public.experience_approvals(merchant_id);
ALTER TABLE public.experience_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_approvals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_approvals TO authenticated;
CREATE POLICY owner_read ON public.experience_approvals FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_draft_heads (merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
 build_id uuid NOT NULL, version bigint NOT NULL CHECK(version>0),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id));
CREATE INDEX experience_draft_heads_merchant_idx ON public.experience_draft_heads(merchant_id);
ALTER TABLE public.experience_draft_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_draft_heads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_draft_heads TO authenticated;
CREATE POLICY owner_read ON public.experience_draft_heads FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_published_heads (merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
 build_id uuid NOT NULL, approval_id uuid NOT NULL, publication_revision bigint NOT NULL, FOREIGN KEY(merchant_id,approval_id) REFERENCES public.experience_approvals(merchant_id,id),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id));
CREATE INDEX experience_published_heads_merchant_idx ON public.experience_published_heads(merchant_id);
ALTER TABLE public.experience_published_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_published_heads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_published_heads TO authenticated;
CREATE POLICY owner_read ON public.experience_published_heads FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_catalog_generations (merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE, generation bigint NOT NULL DEFAULT 1 CHECK(generation>0));
CREATE INDEX experience_catalog_generations_merchant_idx ON public.experience_catalog_generations(merchant_id);
ALTER TABLE public.experience_catalog_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_catalog_generations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_catalog_generations TO authenticated;
CREATE POLICY owner_read ON public.experience_catalog_generations FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_build_files (merchant_id uuid NOT NULL, build_id uuid NOT NULL, path text NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL, mime text NOT NULL, PRIMARY KEY(build_id,path),
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_build_files_merchant_idx ON public.experience_build_files(merchant_id);
ALTER TABLE public.experience_build_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_build_files FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_build_files TO authenticated;
CREATE POLICY owner_read ON public.experience_build_files FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_uploads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, manifest jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour', finalized_artifact_id uuid,
 UNIQUE(merchant_id,id), FOREIGN KEY(merchant_id,finalized_artifact_id) REFERENCES public.experience_artifacts(merchant_id,id));
CREATE INDEX experience_uploads_merchant_idx ON public.experience_uploads(merchant_id);
ALTER TABLE public.experience_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_uploads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_uploads TO authenticated;
CREATE POLICY owner_read ON public.experience_uploads FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));

CREATE TABLE public.experience_chunks (merchant_id uuid NOT NULL, upload_id uuid NOT NULL, path text NOT NULL, byte_offset integer NOT NULL CHECK(byte_offset>=0),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 32768), digest text NOT NULL,
 PRIMARY KEY(upload_id,path,byte_offset), FOREIGN KEY(merchant_id,upload_id) REFERENCES public.experience_uploads(merchant_id,id) ON DELETE CASCADE);
CREATE INDEX experience_chunks_merchant_idx ON public.experience_chunks(merchant_id);
ALTER TABLE public.experience_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_chunks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_chunks TO authenticated;
CREATE POLICY owner_read ON public.experience_chunks FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));
CREATE INDEX experience_jobs_artifact_id_idx ON public.experience_jobs(artifact_id);
CREATE INDEX experience_approvals_build_id_idx ON public.experience_approvals(build_id);
CREATE INDEX experience_draft_heads_build_id_idx ON public.experience_draft_heads(build_id);
CREATE INDEX experience_published_heads_build_id_idx ON public.experience_published_heads(build_id);
CREATE INDEX experience_published_heads_approval_id_idx ON public.experience_published_heads(approval_id);
CREATE INDEX experience_uploads_actor_user_id_idx ON public.experience_uploads(actor_user_id);
CREATE INDEX experience_uploads_finalized_artifact_id_idx ON public.experience_uploads(finalized_artifact_id);

-- Metadata only: staff can learn authoring mode, never private source.
CREATE FUNCTION public.experience_authoring_mode_for_merchant(p_merchant uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.check_staff_permission(auth.uid(),p_merchant,'builder','view') OR public.check_staff_permission(auth.uid(),p_merchant,'builder','edit')) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN EXISTS(SELECT 1 FROM public.experience_draft_heads WHERE merchant_id=p_merchant) THEN 'full-code' ELSE 'legacy' END;
END $$;
REVOKE ALL ON FUNCTION public.experience_authoring_mode_for_merchant(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_authoring_mode_for_merchant(uuid) TO authenticated;
-- Authoring/upload/job RPCs follow in Task 4/5. No writer or proof role is granted here.
