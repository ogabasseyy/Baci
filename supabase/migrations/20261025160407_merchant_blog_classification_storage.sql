-- Merchant classification is separate from the platform-only blog_posts intent.
-- No identities are provisioned here. Approved writer registration is a separate
-- operator action, scoped to one authenticated user, merchant and expiry.
BEGIN;

CREATE UNIQUE INDEX blog_posts_id_merchant_classification_key
  ON public.blog_posts(id, merchant_id);

CREATE TABLE public.merchant_blog_classifications (
  post_id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  intent text NOT NULL CHECK (intent IN ('news','comparison','repair-guide','buying-guide')),
  source text NOT NULL CHECK (source IN ('merchant_declared','verified_receipt','reviewed')),
  taxonomy_version integer NOT NULL DEFAULT 1 CHECK (taxonomy_version = 1),
  classifier_version text NOT NULL CHECK (char_length(classifier_version) BETWEEN 1 AND 80),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  classified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stale_at timestamptz,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT merchant_blog_classifications_post_merchant_fkey
    FOREIGN KEY(post_id,merchant_id) REFERENCES public.blog_posts(id,merchant_id) ON DELETE CASCADE,
  CONSTRAINT merchant_blog_classification_evidence_contract CHECK (
    (source='merchant_declared' AND evidence_sha256 IS NULL)
    OR (source IN ('verified_receipt','reviewed') AND evidence_sha256 IS NOT NULL)
  )
);
CREATE INDEX merchant_blog_classifications_merchant_idx ON public.merchant_blog_classifications(merchant_id,post_id);
CREATE INDEX merchant_blog_classifications_actor_idx ON public.merchant_blog_classifications(actor_id);
ALTER TABLE public.merchant_blog_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_blog_classifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_blog_classifications FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.merchant_blog_classification_writers (
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  allowed_sources text[] NOT NULL CHECK (
    cardinality(allowed_sources) BETWEEN 1 AND 2
    AND allowed_sources <@ ARRAY['verified_receipt','reviewed']::text[]
    AND array_position(allowed_sources,NULL) IS NULL
  ),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(auth_user_id,merchant_id)
);
CREATE INDEX merchant_blog_classification_writers_merchant_idx ON private.merchant_blog_classification_writers(merchant_id);
ALTER TABLE private.merchant_blog_classification_writers ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.merchant_blog_classification_writers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.merchant_blog_classification_writers FROM PUBLIC,anon,authenticated,service_role;

-- The generic audit ledger deliberately rejects arbitrary provenance metadata.
-- Keep a tiny append-only private ledger, not a second public event API. Snapshot
-- identifiers intentionally have no source FKs so deletion preserves evidence.
CREATE TABLE private.merchant_blog_classification_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  actor_id uuid,
  operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX merchant_blog_classification_audit_post_idx ON private.merchant_blog_classification_audit(merchant_id,post_id,id);
ALTER TABLE private.merchant_blog_classification_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.merchant_blog_classification_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.merchant_blog_classification_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.merchant_blog_classification_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.merchant_blog_input_fingerprint_v1(p_post public.blog_posts)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_array(
    p_post.title,p_post.content,p_post.category,p_post.excerpt,p_post.tags,p_post.keywords
  )::text,'sha256'),'hex')
$$;
REVOKE ALL ON FUNCTION private.merchant_blog_input_fingerprint_v1(public.blog_posts) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.audit_merchant_blog_classification_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO private.merchant_blog_classification_audit(post_id,merchant_id,actor_id,operation,before_value,after_value)
  VALUES(coalesce(NEW.post_id,OLD.post_id),coalesce(NEW.merchant_id,OLD.merchant_id),
    (SELECT auth.uid()),TG_OP,CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION private.audit_merchant_blog_classification_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_merchant_blog_classification
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_blog_classifications
  FOR EACH ROW EXECUTE FUNCTION private.audit_merchant_blog_classification_v1();

CREATE FUNCTION private.invalidate_merchant_blog_classification_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Trigger execution inherits authorization from blog_posts DML. It also
  -- covers direct PostgREST/SQL edits, not only one application route.
  IF ROW(NEW.title,NEW.content,NEW.category,NEW.excerpt,NEW.tags,NEW.keywords)
     IS DISTINCT FROM ROW(OLD.title,OLD.content,OLD.category,OLD.excerpt,OLD.tags,OLD.keywords) THEN
    UPDATE public.merchant_blog_classifications SET stale_at=clock_timestamp()
    WHERE post_id=NEW.id AND stale_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.invalidate_merchant_blog_classification_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invalidate_merchant_blog_classification
  AFTER UPDATE OF title,content,category,excerpt,tags,keywords ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_merchant_blog_classification_v1();

COMMENT ON TABLE public.merchant_blog_classifications IS
  'Current merchant article taxonomy only. Not publication approval. Direct client DML is forbidden; fingerprint-bound RPCs enforce provenance and tenant scope.';
COMMIT;
