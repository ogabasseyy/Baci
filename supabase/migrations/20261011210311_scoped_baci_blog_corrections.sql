-- Owner-approved correction-only authority for these two existing platform posts.
CREATE TABLE baci_blog_release_private.corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES baci_blog_release_private.publishers(user_id),
  post_id uuid NOT NULL REFERENCES public.blog_posts(id),
  expected_updated_at timestamptz NOT NULL,
  expected_content_sha256 text NOT NULL CHECK (expected_content_sha256 ~ '^[0-9a-f]{64}$'),
  content text NOT NULL CHECK (length(btrim(content)) > 0 AND length(content) <= 1000000),
  excerpt text CHECK (length(excerpt) <= 500),
  word_count integer NOT NULL CHECK (word_count > 0),
  reading_time_minutes integer NOT NULL CHECK (reading_time_minutes > 0),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by text NOT NULL CHECK (length(btrim(approved_by)) > 0),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  revoked_at timestamptz,
  applied_at timestamptz,
  applied_xid xid8,
  CHECK (post_id IN ('df7c8d06-bfa2-4171-948e-548cb2f463a6', '8642fd90-400b-4264-a954-f588da5ccd59')),
  CHECK (expires_at > approved_at AND expires_at <= approved_at + interval '24 hours'),
  CHECK ((applied_at IS NULL) = (applied_xid IS NULL))
);
CREATE INDEX baci_blog_correction_publisher_idx ON baci_blog_release_private.corrections(publisher_id);
CREATE INDEX baci_blog_correction_post_idx ON baci_blog_release_private.corrections(post_id);
ALTER TABLE baci_blog_release_private.corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON baci_blog_release_private.corrections FROM PUBLIC, anon, authenticated;

CREATE FUNCTION baci_blog_release_private.hash_correction_payload()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    (to_jsonb(NEW) - ARRAY['revoked_at','applied_at','applied_xid','payload_sha256'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revoked_at','applied_at','applied_xid','payload_sha256'])
  ) THEN RAISE EXCEPTION 'Approved correction is immutable' USING ERRCODE = '42501'; END IF;
  payload := to_jsonb(NEW) - ARRAY['revoked_at','applied_at','applied_xid','payload_sha256'];
  NEW.payload_sha256 := encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER hash_correction_payload BEFORE INSERT OR UPDATE
ON baci_blog_release_private.corrections FOR EACH ROW
EXECUTE FUNCTION baci_blog_release_private.hash_correction_payload();
REVOKE ALL ON FUNCTION baci_blog_release_private.hash_correction_payload() FROM PUBLIC, anon, authenticated;

-- The audit guard checks both old and new row, in the exact RPC transaction.
CREATE FUNCTION private.is_approved_baci_blog_correction_v1(p_old public.blog_posts, p_new public.blog_posts)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM baci_blog_release_private.corrections c
   JOIN baci_blog_release_private.publishers p ON p.user_id = c.publisher_id
   WHERE p.user_id = auth.uid() AND p.enabled AND c.revoked_at IS NULL
     AND c.approved_at <= now() AND c.expires_at > now()
     AND c.applied_xid = pg_current_xact_id() AND c.applied_at = now()
     AND c.post_id = p_old.id AND c.post_id = p_new.id
     AND p_old.merchant_id IS NULL AND p_old.is_platform_post IS TRUE AND p_old.status = 'published'
     AND p_old.updated_at = c.expected_updated_at
     AND encode(sha256(convert_to(p_old.content, 'UTF8')), 'hex') = c.expected_content_sha256
     AND p_new.content = c.content AND p_new.excerpt IS NOT DISTINCT FROM c.excerpt
     AND p_new.word_count = c.word_count AND p_new.reading_time_minutes = c.reading_time_minutes
     AND (to_jsonb(p_new) - ARRAY['content','excerpt','word_count','reading_time_minutes','updated_at','search_vector'])
       = (to_jsonb(p_old) - ARRAY['content','excerpt','word_count','reading_time_minutes','updated_at','search_vector'])
 );
$$;
REVOKE ALL ON FUNCTION private.is_approved_baci_blog_correction_v1(public.blog_posts, public.blog_posts)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION baci_blog_release_private.apply_approved_correction(p_revision_id uuid)
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
    jsonb_build_object('revision_id',correction.id,'payload_sha256',correction.payload_sha256,
      'previous_content_sha256',correction.expected_content_sha256,'approved_by',correction.approved_by,
      'approved_at',correction.approved_at,'result','succeeded'));
  RETURN jsonb_build_object('post_id',post.id,'slug',post.slug,'revision_id',correction.id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION baci_blog_release_private.apply_approved_correction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION baci_blog_release_private.apply_approved_correction(uuid) TO authenticated;
CREATE FUNCTION public.apply_approved_baci_blog_correction(p_revision_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT baci_blog_release_private.apply_approved_correction(p_revision_id);
$$;
REVOKE ALL ON FUNCTION public.apply_approved_baci_blog_correction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_approved_baci_blog_correction(uuid) TO authenticated;
