-- Record intent classification and provenance edits in the platform blog audit ledger.
-- The intent columns were added after the trigger; without this repair an intent-only
-- update emits an empty changed_fields array.

BEGIN;

CREATE OR REPLACE FUNCTION private.audit_platform_blog_post_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_action text;
  v_resource_id text;
  v_changed_fields text[] := ARRAY[]::text[];
  v_old_is_platform_post boolean := FALSE;
  v_new_is_platform_post boolean := FALSE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_is_platform_post := OLD.is_platform_post IS TRUE
      AND OLD.merchant_id IS NULL;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_is_platform_post := NEW.is_platform_post IS TRUE
      AND NEW.merchant_id IS NULL;
  END IF;

  IF TG_OP = 'INSERT' AND NOT v_new_is_platform_post THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND NOT v_old_is_platform_post THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (v_old_is_platform_post OR v_new_is_platform_post) THEN
    RETURN NEW;
  END IF;

  IF v_actor_user_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'content.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_content_manage_required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'platform_blog_post.created';
    v_resource_id := NEW.id::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'platform_blog_post.updated';
    v_resource_id := NEW.id::text;
    v_changed_fields := array_remove(ARRAY[
      CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN 'title' END,
      CASE WHEN NEW.content IS DISTINCT FROM OLD.content THEN 'content' END,
      CASE WHEN NEW.excerpt IS DISTINCT FROM OLD.excerpt THEN 'excerpt' END,
      CASE WHEN NEW.featured_image_url IS DISTINCT FROM OLD.featured_image_url THEN 'featured_image_url' END,
      CASE WHEN NEW.featured_image_width IS DISTINCT FROM OLD.featured_image_width THEN 'featured_image_width' END,
      CASE WHEN NEW.featured_image_height IS DISTINCT FROM OLD.featured_image_height THEN 'featured_image_height' END,
      CASE WHEN NEW.featured_image_variants IS DISTINCT FROM OLD.featured_image_variants THEN 'featured_image_variants' END,
      CASE WHEN NEW.slug IS DISTINCT FROM OLD.slug THEN 'slug' END,
      CASE WHEN NEW.category IS DISTINCT FROM OLD.category THEN 'category' END,
      CASE WHEN NEW.tags IS DISTINCT FROM OLD.tags THEN 'tags' END,
      CASE WHEN NEW.keywords IS DISTINCT FROM OLD.keywords THEN 'keywords' END,
      CASE WHEN NEW.focus_keyword IS DISTINCT FROM OLD.focus_keyword THEN 'focus_keyword' END,
      CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status' END,
      CASE WHEN NEW.published_at IS DISTINCT FROM OLD.published_at THEN 'published_at' END,
      CASE WHEN NEW.is_platform_post IS DISTINCT FROM OLD.is_platform_post THEN 'is_platform_post' END,
      CASE WHEN NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN 'merchant_id' END,
      CASE WHEN NEW.intent IS DISTINCT FROM OLD.intent THEN 'intent' END,
      CASE WHEN NEW.intent_source IS DISTINCT FROM OLD.intent_source THEN 'intent_source' END
    ]::text[], NULL);
  ELSE
    v_action := 'platform_blog_post.deleted';
    v_resource_id := OLD.id::text;
  END IF;

  INSERT INTO public.platform_audit_events (
    actor_user_id, action, resource_type, resource_id, changed_fields, metadata
  ) VALUES (
    v_actor_user_id,
    v_action,
    'platform_blog_post',
    v_resource_id,
    v_changed_fields,
    pg_catalog.jsonb_build_object(
      'category', 'content',
      'operation', CASE TG_OP
        WHEN 'INSERT' THEN 'create'
        WHEN 'UPDATE' THEN 'update'
        ELSE 'delete'
      END,
      'result', 'succeeded'
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
