-- Independently verified renderer bytes follow the evidence and job lifecycle.
-- Browser clients keep using the separate published JS/CSS projection.
CREATE TABLE experience_authorization.verified_renderers (
  job_id uuid NOT NULL,
  attempt_nonce uuid NOT NULL,
  renderer jsonb NOT NULL CHECK (
    (jsonb_typeof(renderer) = 'object'
      AND renderer->>'digest' ~ '^[a-f0-9]{64}$'
      AND octet_length(renderer::text) BETWEEN 1 AND 33554432) IS TRUE
  ),
  PRIMARY KEY (job_id, attempt_nonce),
  FOREIGN KEY (job_id, attempt_nonce)
    REFERENCES public.experience_evidence(job_id, attempt_nonce) ON DELETE CASCADE
);

ALTER TABLE experience_authorization.verified_renderers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON experience_authorization.verified_renderers FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT (job_id, attempt_nonce, renderer)
  ON experience_authorization.verified_renderers TO baci_experience_verifier;
CREATE POLICY independent_verifier_insert ON experience_authorization.verified_renderers
  FOR INSERT TO baci_experience_verifier WITH CHECK (true);

-- Both inserts share one transaction even across an autocommit connection.
CREATE FUNCTION experience_authorization.record_verified_renderer(
  p_merchant uuid, p_job uuid, p_attempt uuid, p_build text,
  p_receipt text, p_host_origin text, p_renderer jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.experience_evidence(
    merchant_id, job_id, attempt_nonce, build_digest, receipt_digest, host_origin
  ) VALUES (p_merchant, p_job, p_attempt, p_build, p_receipt, p_host_origin);
  INSERT INTO experience_authorization.verified_renderers(job_id, attempt_nonce, renderer)
    VALUES (p_job, p_attempt, p_renderer);
END $$;
REVOKE ALL ON FUNCTION experience_authorization.record_verified_renderer(
  uuid, uuid, uuid, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION experience_authorization.record_verified_renderer(
  uuid, uuid, uuid, text, text, text, jsonb
) TO baci_experience_verifier;

CREATE FUNCTION public.experience_finalize_prerender_build(
  p_merchant uuid, p_connection uuid, p_version bigint, p_job uuid,
  p_attempt uuid, p_source text, p_build text, p_receipt text, p_retry uuid,
  p_files jsonb, p_host_origin text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.experience_require_owner(p_merchant, p_connection, p_version);
  PERFORM 1 FROM public.experience_jobs
    WHERE merchant_id = p_merchant AND id = p_job
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILD_FAILED'; END IF;

  PERFORM 1 FROM public.experience_evidence AS e
    JOIN experience_authorization.verified_renderers AS r
      USING (job_id, attempt_nonce)
    WHERE e.merchant_id = p_merchant AND e.job_id = p_job
      AND e.attempt_nonce = p_attempt AND e.build_digest = p_build
      AND e.receipt_digest = p_receipt AND e.host_origin = p_host_origin
    FOR KEY SHARE OF e, r;
  IF NOT FOUND THEN RAISE EXCEPTION 'RENDERER_NOT_RETAINED'; END IF;

  RETURN public.experience_finalize_build(
    p_merchant, p_connection, p_version, p_job, p_attempt, p_source,
    p_build, p_receipt, p_retry, p_files, p_host_origin
  );
END $$;
REVOKE ALL ON FUNCTION public.experience_finalize_prerender_build(
  uuid, uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_finalize_prerender_build(
  uuid, uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, text
) TO authenticated;

CREATE FUNCTION experience_authorization.exact_verified_renderer(
  p_merchant uuid, p_build_id uuid, p_digest text, p_source text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.renderer
  FROM public.experience_builds AS b
  JOIN public.experience_jobs AS j
    ON j.merchant_id = b.merchant_id AND j.id = b.job_id
  JOIN public.experience_evidence AS e
    ON e.merchant_id = b.merchant_id AND e.job_id = j.id
      AND e.attempt_nonce = j.attempt_nonce
      AND e.build_digest = b.build_digest AND e.host_origin = b.host_origin
  JOIN experience_authorization.verified_renderers AS r
    ON r.job_id = e.job_id AND r.attempt_nonce = e.attempt_nonce
  WHERE b.merchant_id = p_merchant AND b.id = p_build_id
    AND b.build_digest = p_digest AND j.source_digest = p_source
    AND j.status = 'finalized';
$$;
REVOKE ALL ON FUNCTION experience_authorization.exact_verified_renderer(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role, baci_experience_verifier;

CREATE FUNCTION public.experience_read_prerender_build(
  p_merchant uuid, p_connection uuid, p_version bigint, p_build_id uuid,
  p_digest text, p_source text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.experience_authorize_read(p_merchant, p_connection, p_version);
  RETURN experience_authorization.exact_verified_renderer(
    p_merchant, p_build_id, p_digest, p_source
  );
END $$;
REVOKE ALL ON FUNCTION public.experience_read_prerender_build(uuid, uuid, bigint, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_read_prerender_build(uuid, uuid, bigint, uuid, text, text)
  TO authenticated;

CREATE ROLE baci_experience_renderer_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA experience_authorization TO baci_experience_renderer_reader;

CREATE FUNCTION experience_authorization.read_published_verified_renderer(
  p_slug text, p_merchant uuid, p_build_id uuid, p_digest text, p_source text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT experience_authorization.exact_verified_renderer(
    (binding->>'merchantId')::uuid, (binding->>'buildId')::uuid,
    binding->>'buildDigest', binding->>'sourceDigest'
  )
  FROM public.experience_public_prerender_binding(p_slug, p_digest) AS binding
  WHERE binding->>'merchantId' = p_merchant::text
    AND binding->>'buildId' = p_build_id::text
    AND binding->>'sourceDigest' = p_source;
$$;
REVOKE ALL ON FUNCTION experience_authorization.read_published_verified_renderer(text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role, baci_experience_verifier;
GRANT EXECUTE ON FUNCTION experience_authorization.read_published_verified_renderer(text, uuid, uuid, text, text)
  TO baci_experience_renderer_reader;
