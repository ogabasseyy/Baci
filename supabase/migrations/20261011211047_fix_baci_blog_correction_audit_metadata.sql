-- Keep the audit metadata allowlist; reason_code links to the immutable revision.
CREATE OR REPLACE FUNCTION baci_blog_release_private.apply_approved_correction(p_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  correction baci_blog_release_private.corrections;
  post record;
  publisher uuid;
  expected_payload_hash text;
BEGIN
  SELECT user_id INTO publisher FROM baci_blog_release_private.publishers
  WHERE user_id = auth.uid() AND enabled FOR SHARE;
  IF publisher IS NULL THEN
    RAISE EXCEPTION 'Publisher not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT c.id,c.publisher_id,c.post_id,c.expected_updated_at,c.expected_content_sha256,
    c.content,c.excerpt,c.word_count,c.reading_time_minutes,c.payload_sha256,c.approved_by,
    c.approved_at,c.expires_at,c.revoked_at,c.applied_at,c.applied_xid
  INTO correction FROM baci_blog_release_private.corrections c
  WHERE c.id = p_revision_id AND c.publisher_id = publisher FOR UPDATE;
  IF NOT FOUND OR correction.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Correction unavailable' USING ERRCODE = '42501';
  END IF;
  expected_payload_hash := encode(sha256(convert_to(
    (to_jsonb(correction) - ARRAY['revoked_at','applied_at','applied_xid','payload_sha256'])::text,
    'UTF8')), 'hex');
  IF expected_payload_hash <> correction.payload_sha256 THEN
    RAISE EXCEPTION 'Correction hash mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT b.id,b.slug,b.content,b.excerpt,b.word_count,b.reading_time_minutes,
    b.updated_at,b.merchant_id,b.is_platform_post,b.status
  INTO post FROM public.blog_posts b WHERE b.id = correction.post_id FOR UPDATE;
  IF NOT FOUND OR post.merchant_id IS NOT NULL OR post.is_platform_post IS NOT TRUE OR post.status <> 'published' THEN
    RAISE EXCEPTION 'Correction target unavailable' USING ERRCODE = '42501';
  END IF;
  IF correction.applied_at IS NOT NULL THEN
    IF post.content IS DISTINCT FROM correction.content OR post.excerpt IS DISTINCT FROM correction.excerpt
       OR post.word_count IS DISTINCT FROM correction.word_count
       OR post.reading_time_minutes IS DISTINCT FROM correction.reading_time_minutes THEN
      RAISE EXCEPTION 'Corrected article has changed' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('post_id',post.id,'slug',post.slug,'revision_id',correction.id,'replayed',true);
  END IF;
  IF correction.approved_at > now() OR correction.expires_at <= now() THEN
    RAISE EXCEPTION 'Correction approval expired' USING ERRCODE = '42501';
  END IF;
  IF post.updated_at IS DISTINCT FROM correction.expected_updated_at
     OR encode(sha256(convert_to(post.content,'UTF8')),'hex') IS DISTINCT FROM correction.expected_content_sha256 THEN
    RAISE EXCEPTION 'Live article changed since review' USING ERRCODE = '40001';
  END IF;
  UPDATE baci_blog_release_private.corrections
  SET applied_at=now(), applied_xid=pg_current_xact_id() WHERE id=correction.id;
  UPDATE public.blog_posts SET content=correction.content, excerpt=correction.excerpt,
    word_count=correction.word_count, reading_time_minutes=correction.reading_time_minutes
  WHERE id=post.id;
  INSERT INTO public.platform_audit_events
    (actor_user_id,action,resource_type,resource_id,changed_fields,metadata)
  VALUES (publisher,'platform_blog_post.corrected','platform_blog_post',post.id::text,
    ARRAY['content','excerpt','word_count','reading_time_minutes'],
    jsonb_build_object('category','content','operation','approved_correction',
      'reason_code',correction.id::text,'result','succeeded'));
  RETURN jsonb_build_object('post_id',post.id,'slug',post.slug,'revision_id',correction.id,'replayed',false);
END;
$$;

