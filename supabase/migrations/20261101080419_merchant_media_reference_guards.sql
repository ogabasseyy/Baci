-- The same gates are taken by reference writes and deletion admission.
-- Stable relation OIDs follow the coordinated private-draft schema move.
CREATE FUNCTION private.guard_merchant_media_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fresh text; prior text:=''; ids uuid[];
BEGIN
 fresh:=private.merchant_media_reference_text(to_jsonb(NEW)-ARRAY['updated_at','created_at']);
 IF TG_OP='UPDATE' THEN
  prior:=private.merchant_media_reference_text(to_jsonb(OLD)-ARRAY['updated_at','created_at']);
  IF fresh=prior THEN RETURN NEW; END IF;
 END IF;
 ids:=private.merchant_media_reference_ids(fresh||' '||prior);
 PERFORM private.lock_merchant_media_references(ids);
 IF EXISTS(SELECT 1 FROM private.merchant_media_delete_claims c
   WHERE (c.merchant_id=ANY(ids) OR c.object_id=ANY(ids))
    AND (strpos(fresh,lower(c.path))>0 OR strpos(fresh,c.object_id::text)>0)) THEN
  RAISE EXCEPTION 'media_pending_deletion' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_merchant_media_references() FROM PUBLIC,anon,authenticated,service_role;

-- Current catalog/content consumers, including rollback-capable page history,
-- both draft storage contracts, pending builder operations and issuance snapshots.
-- Missing optional relations are not silently accepted: main's required set is
-- asserted below, and every registered relation must retain its guard at admission.
DO $sources$
DECLARE source text; target regclass;
BEGIN
 FOREACH source IN ARRAY ARRAY[
  'public.merchants','public.products','public.product_variants','public.product_offers',
  'public.product_feed_images','public.product_offer_migration_archive',
  'public.categories','public.brands','public.loyalty_rewards','public.ai_hero_images',
  'public.blog_posts','public.platform_blog_posts','public.platform_settings',
  'public.page_configs','public.page_config_history','public.builder_page_drafts',
  'builder_authorization.builder_page_drafts','public.builder_edit_operations',
  'builder_authorization.builder_edit_operations','public.merchant_feature_settings',
  'public.merchant_agents','public.negotiation_requests','public.order_items'
 ] LOOP
  target:=to_regclass(source);
  IF target IS NULL THEN
   IF source IN ('public.merchants','public.products','public.page_configs','public.blog_posts') THEN
    RAISE EXCEPTION 'media_reference_source_missing: %',source;
   END IF;
   CONTINUE;
  END IF;
  -- Compatibility views delegate to the registered underlying storage table.
  IF (SELECT relkind FROM pg_class WHERE oid=target) NOT IN ('r','p') THEN CONTINUE; END IF;
  INSERT INTO private.merchant_media_reference_sources VALUES(target) ON CONFLICT DO NOTHING;
  EXECUTE format('CREATE TRIGGER merchant_media_reference_guard BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION private.guard_merchant_media_references()',target);
 END LOOP;
END;
$sources$;
