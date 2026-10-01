-- Audit authenticated platform mutations without copying notification or post content.
-- Scheduled notification workers run without auth.uid(), so their lifecycle
-- transitions are deliberately excluded from the operator audit timeline.

BEGIN;

CREATE OR REPLACE FUNCTION private.audit_platform_notification_mutation_v1()
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
BEGIN
  IF v_actor_user_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'notifications.manage'
  ) THEN
    RAISE EXCEPTION 'platform_admin_notifications_manage_required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'notification.created';
    v_resource_id := NEW.id::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'notification.updated';
    v_resource_id := NEW.id::text;
    v_changed_fields := array_remove(ARRAY[
      CASE WHEN NEW.template_id IS DISTINCT FROM OLD.template_id THEN 'template_id' END,
      CASE WHEN NEW.notification_type IS DISTINCT FROM OLD.notification_type THEN 'notification_type' END,
      CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority THEN 'priority' END,
      CASE WHEN NEW.target_type IS DISTINCT FROM OLD.target_type THEN 'target_type' END,
      CASE WHEN NEW.channels IS DISTINCT FROM OLD.channels THEN 'channels' END,
      CASE WHEN NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN 'scheduled_for' END,
      CASE WHEN NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN 'expires_at' END,
      CASE WHEN NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN 'sent_at' END,
      CASE WHEN NEW.is_system IS DISTINCT FROM OLD.is_system THEN 'is_system' END,
      CASE WHEN NEW.delivery_state IS DISTINCT FROM OLD.delivery_state THEN 'delivery_state' END,
      CASE WHEN NEW.delivery_attempts IS DISTINCT FROM OLD.delivery_attempts THEN 'delivery_attempts' END
    ]::text[], NULL);
  ELSE
    v_action := 'notification.deleted';
    v_resource_id := OLD.id::text;
  END IF;

  INSERT INTO public.platform_audit_events (
    actor_user_id, action, resource_type, resource_id, changed_fields, metadata
  ) VALUES (
    v_actor_user_id,
    v_action,
    'notification',
    v_resource_id,
    v_changed_fields,
    pg_catalog.jsonb_build_object(
      'category', 'notifications',
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

ALTER FUNCTION private.audit_platform_notification_mutation_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_platform_notification_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_platform_notification_mutation_v1
  ON public.notifications;
CREATE TRIGGER audit_platform_notification_mutation_v1
AFTER INSERT OR UPDATE OR DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION private.audit_platform_notification_mutation_v1();

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
      CASE WHEN NEW.slug IS DISTINCT FROM OLD.slug THEN 'slug' END,
      CASE WHEN NEW.category IS DISTINCT FROM OLD.category THEN 'category' END,
      CASE WHEN NEW.tags IS DISTINCT FROM OLD.tags THEN 'tags' END,
      CASE WHEN NEW.keywords IS DISTINCT FROM OLD.keywords THEN 'keywords' END,
      CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'status' END,
      CASE WHEN NEW.published_at IS DISTINCT FROM OLD.published_at THEN 'published_at' END,
      CASE WHEN NEW.is_platform_post IS DISTINCT FROM OLD.is_platform_post THEN 'is_platform_post' END,
      CASE WHEN NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN 'merchant_id' END
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

ALTER FUNCTION private.audit_platform_blog_post_mutation_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_platform_blog_post_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_platform_blog_post_mutation_v1
  ON public.blog_posts;
CREATE TRIGGER audit_platform_blog_post_mutation_v1
AFTER INSERT OR UPDATE OR DELETE ON public.blog_posts
FOR EACH ROW EXECUTE FUNCTION private.audit_platform_blog_post_mutation_v1();

COMMIT;
