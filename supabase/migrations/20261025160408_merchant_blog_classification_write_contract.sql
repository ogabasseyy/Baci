BEGIN;

CREATE FUNCTION private.can_access_merchant_blog_classification_v1(p_merchant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (SELECT auth.jwt()->>'role')='authenticated'
    AND (public.check_staff_permission((SELECT auth.uid()),p_merchant_id,'marketing','edit')
      OR EXISTS(SELECT 1 FROM private.merchant_blog_classification_writers w
        WHERE w.auth_user_id=(SELECT auth.uid()) AND w.merchant_id=p_merchant_id
          AND w.active AND w.expires_at>statement_timestamp()))
$$;
REVOKE ALL ON FUNCTION private.can_access_merchant_blog_classification_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.set_merchant_blog_classification_v1(
  p_merchant_id uuid,p_post_id uuid,p_intent text,p_expected_fingerprint text,
  p_classifier_version text,p_evidence_sha256 text,p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_post public.blog_posts;
  v_existing public.merchant_blog_classifications;
  v_fingerprint text;
  v_priority integer;
  v_existing_priority integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT coalesce(private.can_access_merchant_blog_classification_v1(p_merchant_id),false) THEN
    RAISE EXCEPTION 'Classification access denied' USING ERRCODE='42501';
  END IF;
  IF p_post_id IS NULL OR p_expected_fingerprint IS NULL
    OR p_expected_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_classifier_version IS NULL OR char_length(btrim(p_classifier_version)) NOT BETWEEN 1 AND 80
    OR p_source IS NULL OR p_source NOT IN ('merchant_declared','verified_receipt','reviewed')
    OR (p_intent IS NOT NULL AND p_intent NOT IN ('news','comparison','repair-guide','buying-guide')) THEN
    RAISE EXCEPTION 'Invalid classification input' USING ERRCODE='22023';
  END IF;
  IF p_source='merchant_declared' THEN
    IF NOT coalesce(public.check_staff_permission((SELECT auth.uid()),p_merchant_id,'marketing','edit'),false) THEN
      RAISE EXCEPTION 'Classification source denied' USING ERRCODE='42501';
    END IF;
    IF p_evidence_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'Declared classification cannot claim evidence' USING ERRCODE='22023';
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM private.merchant_blog_classification_writers w
      WHERE w.auth_user_id=(SELECT auth.uid()) AND w.merchant_id=p_merchant_id
      AND w.active AND w.expires_at>statement_timestamp() AND p_source=ANY(w.allowed_sources)) THEN
      RAISE EXCEPTION 'Classification source denied' USING ERRCODE='42501';
    END IF;
    IF p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Verified classification requires evidence digest' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Serialize content edits and all classification writes on the existing post.
  SELECT p.* INTO v_post FROM public.blog_posts p
    WHERE p.id=p_post_id AND p.merchant_id=p_merchant_id AND p.is_platform_post IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Classification access denied' USING ERRCODE='42501'; END IF;
  v_fingerprint := private.merchant_blog_input_fingerprint_v1(v_post);
  IF p_expected_fingerprint<>v_fingerprint THEN
    RAISE EXCEPTION 'Article changed; reload classification context' USING ERRCODE='40001';
  END IF;
  SELECT c.* INTO v_existing FROM public.merchant_blog_classifications c WHERE c.post_id=p_post_id;
  v_priority := CASE p_source WHEN 'reviewed' THEN 3 WHEN 'verified_receipt' THEN 2 ELSE 1 END;
  v_existing_priority := CASE v_existing.source WHEN 'reviewed' THEN 3 WHEN 'verified_receipt' THEN 2 ELSE 1 END;
  IF v_existing.post_id IS NOT NULL AND v_existing.stale_at IS NULL
    AND v_existing.input_fingerprint=v_fingerprint AND v_priority<v_existing_priority THEN
    RAISE EXCEPTION 'A stronger current classification requires an authorized review' USING ERRCODE='42501';
  END IF;
  IF p_intent IS NULL THEN
    DELETE FROM public.merchant_blog_classifications WHERE post_id=p_post_id;
    RETURN jsonb_build_object('post_id',p_post_id,'status','unclassified');
  END IF;
  IF v_existing.stale_at IS NULL AND v_existing.input_fingerprint=v_fingerprint
    AND v_existing.intent=p_intent AND v_existing.source=p_source
    AND v_existing.classifier_version=btrim(p_classifier_version)
    AND v_existing.evidence_sha256 IS NOT DISTINCT FROM p_evidence_sha256 THEN
    v_now := v_existing.classified_at;
  ELSE
    INSERT INTO public.merchant_blog_classifications(post_id,merchant_id,intent,source,
      classifier_version,input_fingerprint,evidence_sha256,classified_at,actor_id)
    VALUES(p_post_id,p_merchant_id,p_intent,p_source,btrim(p_classifier_version),v_fingerprint,
      p_evidence_sha256,v_now,(SELECT auth.uid()))
    ON CONFLICT(post_id) DO UPDATE SET intent=EXCLUDED.intent,source=EXCLUDED.source,
      classifier_version=EXCLUDED.classifier_version,input_fingerprint=EXCLUDED.input_fingerprint,
      evidence_sha256=EXCLUDED.evidence_sha256,classified_at=EXCLUDED.classified_at,
      stale_at=NULL,actor_id=EXCLUDED.actor_id;
  END IF;
  RETURN jsonb_build_object('post_id',p_post_id,'intent',p_intent,'source',p_source,
    'taxonomy_version',1,'classifier_version',btrim(p_classifier_version),
    'classified_at',v_now,'status','current');
END $$;
REVOKE ALL ON FUNCTION private.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text) TO authenticated;

CREATE FUNCTION public.set_merchant_blog_classification_v1(
  p_merchant_id uuid,p_post_id uuid,p_intent text,p_expected_fingerprint text,
  p_classifier_version text,p_evidence_sha256 text DEFAULT NULL,p_source text DEFAULT 'merchant_declared'
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.set_merchant_blog_classification_v1(p_merchant_id,p_post_id,p_intent,
    p_expected_fingerprint,p_classifier_version,p_evidence_sha256,p_source)
$$;
REVOKE ALL ON FUNCTION public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_merchant_blog_classification_v1(uuid,uuid,text,text,text,text,text) TO authenticated;
COMMIT;
