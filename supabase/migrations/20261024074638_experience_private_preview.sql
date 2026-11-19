-- Task 6: short-lived private preview binding, never a public build projection.
CREATE TABLE public.experience_preview_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
 build_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 connection_id uuid REFERENCES builder_authorization.connections(id),grant_version bigint,session_id uuid,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',revoked boolean NOT NULL DEFAULT false,
 FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id)
);
CREATE INDEX experience_preview_bindings_merchant_idx ON public.experience_preview_bindings(merchant_id);
CREATE INDEX experience_preview_bindings_build_idx ON public.experience_preview_bindings(build_id);
CREATE INDEX experience_preview_bindings_actor_idx ON public.experience_preview_bindings(actor_user_id);
CREATE INDEX experience_preview_bindings_connection_idx ON public.experience_preview_bindings(connection_id);
ALTER TABLE public.experience_preview_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_preview_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_preview_bindings TO authenticated;
CREATE POLICY owner_read ON public.experience_preview_bindings FOR SELECT TO authenticated USING(actor_user_id=(SELECT auth.uid()) AND public.experience_owner_readable(merchant_id));
CREATE FUNCTION public.experience_create_preview_binding(p_merchant uuid,p_connection uuid,p_version bigint,p_build uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; sid uuid;
BEGIN
 PERFORM public.experience_require_owner(p_merchant,p_connection,p_version);
 IF NOT EXISTS(SELECT 1 FROM public.experience_builds WHERE id=p_build AND merchant_id=p_merchant) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 IF p_connection IS NULL AND (sid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid())) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 INSERT INTO public.experience_preview_bindings(merchant_id,build_id,actor_user_id,connection_id,grant_version,session_id) VALUES(p_merchant,p_build,auth.uid(),p_connection,p_version,sid) RETURNING id INTO result;RETURN result;
END $$;
-- Opaque identifier discloses only binding liveness. It grants no row/file read.
CREATE FUNCTION public.experience_preview_binding_active(p_binding uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.experience_preview_bindings b JOIN public.merchants m ON m.id=b.merchant_id AND m.user_id=b.actor_user_id
 WHERE b.id=p_binding AND NOT b.revoked AND b.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=b.actor_user_id)
 AND ((b.connection_id IS NULL AND b.session_id IS NOT NULL AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=b.session_id AND s.user_id=b.actor_user_id AND (s.not_after IS NULL OR s.not_after>clock_timestamp())))
 OR (b.connection_id IS NOT NULL AND EXISTS(SELECT 1 FROM builder_authorization.connections c WHERE c.id=b.connection_id AND c.actor_user_id=b.actor_user_id AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.grant_version=b.grant_version AND b.merchant_id=ANY(c.allowed_merchant_ids) AND 'storefront.write'=ANY(c.scopes) AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=b.session_id AND s.user_id=b.actor_user_id AND (s.not_after IS NULL OR s.not_after>clock_timestamp()))))))
$$;
REVOKE ALL ON FUNCTION public.experience_create_preview_binding(uuid,uuid,bigint,uuid),public.experience_preview_binding_active(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.experience_create_preview_binding(uuid,uuid,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.experience_preview_binding_active(uuid) TO anon,authenticated;
