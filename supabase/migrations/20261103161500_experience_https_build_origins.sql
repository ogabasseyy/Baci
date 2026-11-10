-- Accept canonical HTTPS parent origins without changing owner/RLS/verifier authority.
-- Local qualification origins remain valid. This does not publish or enable a profile.
CREATE FUNCTION public.experience_host_origin_valid(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
 SELECT CASE
 WHEN value ~ '^http://(127[.]0[.]0[.]1|localhost):[0-9]{4,5}$' THEN true
 WHEN length(value) <= 300 AND value ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]([a-z0-9-]{0,61}[a-z0-9])?(:[1-9][0-9]{0,4})?$'
 THEN COALESCE(substring(value FROM ':([0-9]+)$')::integer BETWEEN 1 AND 65535
   AND substring(value FROM ':([0-9]+)$')::integer <> 443, true)
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public.experience_host_origin_valid(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_host_origin_valid(text) TO authenticated, baci_experience_verifier;

ALTER TABLE public.experience_builds DROP CONSTRAINT experience_builds_host_origin_check;
ALTER TABLE public.experience_builds ADD CONSTRAINT experience_builds_host_origin_check
 CHECK (public.experience_host_origin_valid(host_origin));
ALTER TABLE public.experience_evidence DROP CONSTRAINT experience_evidence_host_origin_check;
ALTER TABLE public.experience_evidence ADD CONSTRAINT experience_evidence_host_origin_check
 CHECK (public.experience_host_origin_valid(host_origin));
