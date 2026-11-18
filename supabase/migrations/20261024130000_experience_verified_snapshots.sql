-- Independent verifier-only captures. Owner clients may read but cannot certify.
CREATE TABLE public.experience_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL,build_id uuid NOT NULL,build_digest text NOT NULL CHECK(build_digest ~ '^[a-f0-9]{64}$'),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),snapshot_key jsonb NOT NULL CHECK(jsonb_typeof(snapshot_key)='object' AND octet_length(snapshot_key::text)<=4096),
 catalog_revision text CHECK(length(catalog_revision)<=128),consumes_catalog boolean NOT NULL,
 nodes jsonb NOT NULL CHECK(jsonb_typeof(nodes)='array' AND octet_length(nodes::text)<=65536),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),evidence_bytes bytea NOT NULL CHECK(octet_length(evidence_bytes) BETWEEN 1 AND 2097152),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT consumes_catalog OR catalog_revision IS NOT NULL),
 UNIQUE(merchant_id,build_id,key_digest),FOREIGN KEY(merchant_id,build_id) REFERENCES public.experience_builds(merchant_id,id) ON DELETE CASCADE
);
CREATE INDEX experience_snapshots_merchant_idx ON public.experience_snapshots(merchant_id);
CREATE INDEX experience_snapshots_build_idx ON public.experience_snapshots(build_id);
ALTER TABLE public.experience_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.experience_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.experience_snapshots TO authenticated;
CREATE POLICY owner_read ON public.experience_snapshots FOR SELECT TO authenticated USING(public.experience_owner_readable(merchant_id));
GRANT INSERT ON public.experience_snapshots TO baci_experience_verifier;
-- The verifier has no broad table SELECT. An execute-only narrow check avoids
-- granting it private source/build repository access just to enforce the FK.
CREATE OR REPLACE FUNCTION experience_authorization.snapshot_build_matches(p_merchant uuid,p_build uuid,p_digest text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.experience_builds b WHERE b.merchant_id=p_merchant AND b.id=p_build AND b.build_digest=p_digest);
$$;
REVOKE ALL ON FUNCTION experience_authorization.snapshot_build_matches(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA experience_authorization TO baci_experience_verifier;
GRANT EXECUTE ON FUNCTION experience_authorization.snapshot_build_matches(uuid,uuid,text) TO baci_experience_verifier;
CREATE POLICY verifier_insert ON public.experience_snapshots FOR INSERT TO baci_experience_verifier WITH CHECK(experience_authorization.snapshot_build_matches(merchant_id,build_id,build_digest));
CREATE OR REPLACE FUNCTION public.experience_public_snapshot(p_slug text,p_build text,p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('key',s.snapshot_key,'consumesCatalog',s.consumes_catalog,'nodes',s.nodes)
 FROM public.experience_snapshots s JOIN public.experience_builds b ON b.id=s.build_id AND b.merchant_id=s.merchant_id
 JOIN public.experience_published_heads h ON h.build_id=b.id AND h.merchant_id=b.merchant_id
 JOIN public.merchants m ON m.id=h.merchant_id
 WHERE m.slug=p_slug AND b.build_digest=p_build AND s.build_digest=p_build AND s.key_digest=p_key
 AND public.experience_public_manifest(p_slug)->>'buildDigest'=p_build;
$$;
REVOKE ALL ON FUNCTION public.experience_public_snapshot(text,text,text) FROM PUBLIC,service_role;
GRANT EXECUTE ON FUNCTION public.experience_public_snapshot(text,text,text) TO anon,authenticated;
