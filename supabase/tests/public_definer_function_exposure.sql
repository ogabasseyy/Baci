-- =====================================================================
-- REGRESSION TEST: effective EXECUTE exposure of public SECURITY DEFINER
-- functions (the PostgREST /rest/v1/rpc surface) and the default
-- privileges that cause it.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/public_definer_function_exposure.sql
--
-- ROOT CAUSE: functions created by the migration owner (postgres) in
-- schema public are granted EXECUTE to anon, authenticated and
-- service_role by default privileges, and to PUBLIC by PostgreSQL's
-- built-in default. A DROP + CREATE followed by REVOKE ... FROM PUBLIC
-- leaves the direct anon/authenticated grants in place. Migration
-- 20261030233000 closes the defaults and revokes functions with no
-- anon caller; this suite keeps them closed.
--
-- (a) A throwaway function created as the migration owner is not
--     executable by anon, authenticated or PUBLIC (proves the defaults),
--     in schema public and in a brand-new schema.
-- (b) Every public SECURITY DEFINER function that anon can execute, or
--     that carries an explicit PUBLIC grant, is on the allowlist below.
--     A new function that fails here needs either an explicit
--     REVOKE ... FROM PUBLIC, anon (preferred) or an allowlist row with
--     a reason that explains why anonymous callers need it.
-- (c) The functions revoked by the migration are no longer executable
--     by the revoked roles, and still executable by the roles that keep
--     them. A signature missing from this database is skipped with a
--     NOTICE (production-only functions).
--
-- (d) Every function referenced by an RLS policy (public and storage) or by
--     a view runs as the querying role, so that role needs EXECUTE. A
--     SECURITY DEFINER helper added to a policy without an explicit grant
--     would otherwise fail every query on the table with "permission
--     denied for function". Policies TO PUBLIC are checked for anon and
--     authenticated. Plain views are checked for every non-predefined role
--     with table or column SELECT (members of anon/authenticated inherit); a
--     materialized view evaluates its functions only at refresh, as its
--     owner, so the owner is checked. Functions reached only through other
--     functions or other views are not followed.
--
-- The allowlist rows marked FOLLOW-UP are triage items that need code
-- changes (separate PRs). Rows marked PENDING cover fixes that live in
-- other in-flight PRs; delete them when those PRs merge.
-- =====================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, public, extensions;

CREATE TEMP TABLE definer_exposure_allowlist ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('public.can_access_order(uuid,uuid)',
   'RLS/policy helper evaluated for anon sessions'),
  ('public.cancel_storefront_order_as_guest(uuid,text,text)',
   'guest cancel; order id + tracking token verified in SQL'),
  ('public.check_staff_permission(uuid,uuid,text,text)',
   'RLS/policy helper evaluated for anon sessions'),
  ('public.claim_immediate_order_notification_with_proof(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.complete_immediate_order_notification_with_proof(uuid,text,boolean,uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.create_repair_booking_as_owner(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,uuid,uuid)',
   'trampoline for the public repair-booking flow; rate-limited in SQL'),
  ('public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)',
   'FOLLOW-UP: no anon caller (scoped authenticated JWT), but enroll_customer_loyalty_checkout_bridge_identity pins anon EXECUTE; revoke together with that test'),
  ('public.enforce_gigl_tracking_worker_request_scope()',
   'PostgREST pre-request hook; runs for anon requests'),
  ('public.find_nearest_shipping_service_centres(text,double precision,double precision,integer)',
   'public storefront/feed read; anon-safe projection'),
  ('public.flag_guest_payment_provider_confirmed(uuid,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_checkout_shipping_quote(uuid,uuid)',
   'FOLLOW-UP: quote id is the only capability; not tied to caller or session'),
  ('public.get_credit_direct_settings(text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_feed_product_variants(uuid[],uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_follow_up_notification_preference(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_guest_payment_reference_snapshot(text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_invoice_artifact_order_items(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_mcp_search_product_offers(uuid[],uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_mcp_search_product_variants(uuid[],uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_mcp_search_serialized_anchor_policies(uuid[],uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_merchant_product_slug_resolution(uuid,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_merchant_product_slug_set(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_merchant_signup_policy_health()',
   'cron health probe via anon client; booleans only'),
  ('public.get_order_condition_prices(uuid,uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_order_inventory_proof(uuid,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_order_receipt_bank_details(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_order_tracking(text,uuid,text,text,text)',
   'FOLLOW-UP: email + sequential order_number path is enumerable; needs rate limit or token'),
  ('public.get_order_variant_overrides(uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_product_rating_stats(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_public_platform_analytics_config_v1()',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_public_serialized_variant_availability_counts(uuid,uuid[],uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_published_storefront_comparison_revision(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_repair_status(uuid,integer,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_santa_catalog(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_social_proof_stats(uuid,uuid)',
   'FOLLOW-UP: no published/opt-in gate on sales stats; PUBLIC also holds EXECUTE'),
  ('public.get_staff_invite_preview(text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_storefront_blog_classifications_v1(uuid,uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_blog_listing_status(text,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_blog_post_status(text,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_category_slug_state(uuid,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)',
   'FOLLOW-UP: no app caller, but storefront_cluster_guide_* suites pin anon/authenticated/service_role EXECUTE; revoke together with those tests'),
  ('public.get_storefront_cluster_guide_candidates_v2(uuid,text,jsonb,text,integer)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_discount_code(uuid,text,boolean)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_storefront_offer_resolution(uuid,uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_order_quote_validation_context(uuid,uuid,text,text,uuid,boolean)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_storefront_order_replay_economics(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.get_storefront_payment_settings(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_pdp_core_v2(uuid,text,uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_pdp_preflight(text,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_pdp_semantic_enrichment_v1(uuid,uuid,text,jsonb,text,boolean,integer,integer,integer)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_product_base_inventory(uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_product_variants(uuid[])',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_receipt_merchant_info(text)',
   'FOLLOW-UP: slug-wide public bank/tax lookup; mobile storefront still calls it'),
  ('public.get_storefront_redvault_live_pilot_policy()',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_search_price_options(uuid,uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_shipping_rates(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_shipping_sender(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.get_storefront_vtu_settings(uuid)',
   'six VTU enabled flags are intentionally public (20261020090102); older mobile builds may call'),
  ('public.has_merchant_access(uuid)',
   'RLS/policy helper evaluated for anon sessions'),
  ('public.has_storefront_order_idempotency_key(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.increment_blog_post_views(uuid)',
   'public blog view counter; vanity metric only'),
  ('public.insert_invoice_reminder(uuid,text,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.is_legacy_storefront_order_idempotency_key(uuid,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.is_staff_of_merchant(uuid)',
   'RLS/policy helper evaluated for anon sessions'),
  ('public.is_storefront_order_idempotency_hash(uuid,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.issue_credit_direct_checkout_token(uuid,text,uuid,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.mark_immediate_order_notification_started_with_proof(uuid,text,uuid)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.prepare_storefront_order_for_checkout(uuid,uuid,text,text,text,text,uuid,jsonb,boolean)',
   'FOLLOW-UP: token holder can skip route-side quote validation and pin pod inventory'),
  ('public.preview_receipt_claim_v3(text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_analytics_domain_event_v1(uuid,text,text,jsonb,jsonb,jsonb,text,text,text,text,timestamp with time zone,jsonb)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_credit_direct_client_completion(uuid,text,text,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_klump_transaction_id(text,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_platform_domain_event_v1(text,text,jsonb,jsonb,text,uuid,text,text,text,text,text,timestamp with time zone,jsonb)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_receipt_claim_app_download_clicked_v2(text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_receipt_claim_click(text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_receipt_claim_click_v2(text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_receipt_claim_login_started(text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.record_receipt_claim_login_started_v2(text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.redeem_jumia_oauth_handoff_ticket(uuid,text,timestamp with time zone)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.repairs_catalog_publicly_enabled(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.reserve_paystack_order_payment_account(uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,jsonb)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.resolve_public_feed_merchant(text,boolean)',
   'public storefront/feed read; anon-safe projection'),
  ('public.resolve_storefront_auth_merchant(text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.resolve_storefront_custom_domain(text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.resolve_storefront_domain_slug(text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.resolve_storefront_public_snapshot_v2(text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.search_product_discovery_embeddings(vector,uuid,integer,integer)',
   'FOLLOW-UP: no merchant-published gate unlike sibling search RPCs'),
  ('public.search_product_variant_recall(uuid,jsonb,integer,integer,jsonb,jsonb,text,text,text)',
   'public storefront/feed read; anon-safe projection'),
  ('public.search_products_browse(uuid,text,text,text,integer,integer,text,jsonb)',
   'public storefront/feed read; anon-safe projection'),
  ('public.set_credit_direct_session(text,uuid,uuid,text,numeric)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.set_order_payment_ref(uuid,text,text,text)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.storefront_merchant_has_paystack_subaccount(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.storefront_search_merchant_is_visible(uuid)',
   'public storefront/feed read; anon-safe projection'),
  ('public.subscribe_newsletter(text,uuid,text)',
   'FOLLOW-UP: no double opt-in; direct RPC can re-subscribe opted-out emails'),
  ('public.unsubscribe_merchant_onboarding_emails(uuid)',
   'guest or bearer flow; token/secret verified in the body'),
  ('public.unsubscribe_newsletter(text,uuid)',
   'FOLLOW-UP: anon can unsubscribe any email (no token) and probe membership'),
  ('public.finalize_wallet_order_payment(uuid,numeric)',
   'PENDING: PR 3864 (20261030230000) revokes anon and PUBLIC; delete row once merged'),
  ('public.refund_customer_wallet_for_vtu(uuid,uuid,numeric,uuid,text,text)',
   'PENDING: PR 3853 (20261030165610) revokes anon; prod already fixed; delete row once merged')
) AS allowlist(signature, reason);
ALTER TABLE definer_exposure_allowlist ADD PRIMARY KEY (signature);

CREATE TEMP TABLE definer_exposure_revoked ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('public.blog_media_guard_direct_row_references()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.bound_authenticated_paystack_alias_timestamps()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.commerce_cart_prepare_checkout(uuid,integer,text)', ARRAY['anon','authenticated'], ARRAY['commerce_cart_shopper','service_role']),
  ('public.correct_manual_order_document_dates()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.create_merchant_rest_of_world_zone()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.enforce_jumia_active_shop_connection()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.enqueue_order_fulfillment_notification()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.expire_terminal_order_paystack_dva_aliases()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.guard_agentic_paystack_dva_alias()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.guard_merchant_wallet_paystack_dva_alias()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.guard_order_paystack_dva_alias()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.guard_wallet_paystack_dva_alias()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.mark_generated_manual_order_document_dates()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.prevent_rest_of_world_zone_delete()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.prevent_rest_of_world_zone_disable()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.prevent_rest_of_world_zone_location()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.prevent_used_discount_code_identity_mutation()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.preview_receipt_claim(text)', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.quiz_enforce_identity_attempt_cap()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.refresh_pending_shipment_notification_snapshot()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.reject_cross_order_paystack_dva_alias()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.release_loyalty_claims_on_order_cancel()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.reset_order_notification_dispatch_boundary()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.rotate_order_fulfillment_notification_cycle()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.select_abandoned_paystack_attempt_candidates_v1(integer,timestamp with time zone,timestamp with time zone)', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.select_completed_paystack_cancellation_refund_candidates_v1(integer,timestamp with time zone,integer)', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.select_pending_paystack_cancellation_refund_candidates_v1(integer)', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.set_shipping_zone_location_merchant_id()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.snapshot_paystack_order_alias_email()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.sync_manual_order_document_dates_on_update()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.validate_customer_username()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.verify_payment_reference_token(text,text)', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.version_active_paystack_alias_snapshot()', ARRAY['anon','authenticated'], ARRAY['service_role']),
  ('public.begin_order_notification_outbox_dispatch(uuid,uuid,uuid,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.claim_customer_on_phone_auth(uuid,uuid,text,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.claim_jumia_self_authorization_discovery(uuid,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.complete_order_notification_outbox_manual_result(uuid,uuid,text,text,text,text,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.consume_jumia_self_authorization_discovery(uuid,uuid,text,uuid)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.consume_merchant_ads_oauth_state_nonce(text,uuid,uuid,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.consume_snapchat_ads_oauth_state_nonce(uuid,uuid,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.create_jumia_self_authorization_discovery(uuid,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.create_order_wallet_funding_intent_for_customer(uuid,uuid,uuid,uuid,timestamp with time zone)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.create_storefront_order(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)', ARRAY['anon'], ARRAY['authenticated']),
  ('public.create_storefront_order_with_discount_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.delete_legacy_expense_receipt(uuid,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.expire_order_wallet_funding_intents(uuid,uuid,uuid,timestamp with time zone)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.get_order_notification_outbox_manual_terminal_status(uuid,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.get_order_payment_snapshot(uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.get_product_offers(uuid)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.get_record_payment_order_transactions(uuid,uuid)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.persist_authenticated_admin_gigl_quote(jsonb,jsonb,jsonb)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.persist_refreshed_order_shipping_quote(uuid,jsonb,jsonb)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.persist_storefront_order_delivery_metadata(uuid,text,text)', ARRAY['anon'], ARRAY['authenticated']),
  ('public.prepare_order_notification_outbox_manual_send(uuid,uuid,text,text,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.queue_expense_private_receipt_cleanup(uuid,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.queue_unreferenced_expense_private_receipt_cleanup(uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.record_manual_order_payment(uuid,uuid,numeric,text,text,text,jsonb,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.release_jumia_self_authorization_discovery(uuid,uuid,uuid)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.reserve_merchant_ads_oauth_state_nonce(text,uuid,uuid,text,text,timestamp with time zone)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.reserve_snapchat_ads_oauth_state_nonce(uuid,uuid,text,text,timestamp with time zone)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.reset_order_notification_outbox_dispatch(uuid,uuid,uuid,text,text)', ARRAY['anon'], ARRAY['authenticated','service_role']),
  ('public.update_claimed_jumia_self_authorization_discovery(uuid,uuid,uuid,text)', ARRAY['anon'], ARRAY['authenticated','service_role'])
) AS revoked(signature, revoked_from, kept_by);
ALTER TABLE definer_exposure_revoked ADD PRIMARY KEY (signature);

-- (a) default privileges -------------------------------------------------
DO $defaults$
DECLARE
  v_probe record;
BEGIN
  SET LOCAL ROLE postgres;

  CREATE FUNCTION public.zz_definer_exposure_probe()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  AS 'SELECT 1';

  CREATE SCHEMA zz_definer_exposure_probe;
  CREATE FUNCTION zz_definer_exposure_probe.probe()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  AS 'SELECT 1';

  FOR v_probe IN
    SELECT
      proc.oid,
      pg_catalog.pg_get_userbyid(proc.proowner) AS owner_name,
      namespace.nspname || '.' || proc.proname AS function_name,
      COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner)) AS effective_acl
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE (namespace.nspname, proc.proname) IN (
      ('public', 'zz_definer_exposure_probe'),
      ('zz_definer_exposure_probe', 'probe')
    )
    ORDER BY 3
  LOOP
    IF v_probe.owner_name <> 'postgres' THEN
      RAISE EXCEPTION 'probe % must be owned by the migration owner postgres, got %',
        v_probe.function_name, v_probe.owner_name;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_probe.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'new function % is executable by anon: default privileges are open',
        v_probe.function_name;
    END IF;

    IF pg_catalog.has_function_privilege('authenticated', v_probe.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'new function % is executable by authenticated: default privileges are open',
        v_probe.function_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(v_probe.effective_acl) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'new function % has an EXECUTE grant to PUBLIC: the global built-in default is open',
        v_probe.function_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', 'public.zz_definer_exposure_probe()'::pg_catalog.regprocedure, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must keep its default EXECUTE grant on new public functions';
  END IF;

  RESET ROLE;
END
$defaults$;

-- (b) allowlist of anon-executable and PUBLIC-granted definer functions --
DO $allowlist$
DECLARE
  v_anon_unlisted text;
  v_public_unlisted text;
  v_stale text;
BEGIN
  CREATE TEMP TABLE definer_exposure_functions ON COMMIT DROP AS
  SELECT
    proc.oid AS function_oid,
    'public.' || proc.proname || '(' ||
      pg_catalog.replace(pg_catalog.oidvectortypes(proc.proargtypes), ', ', ',') || ')' AS signature,
    COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner)) AS effective_acl
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.prokind IN ('f', 'p')
    AND proc.prosecdef;

  SELECT pg_catalog.string_agg(fn.signature, E'\n  ' ORDER BY fn.signature)
  INTO v_anon_unlisted
  FROM definer_exposure_functions AS fn
  WHERE pg_catalog.has_function_privilege('anon', fn.function_oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM definer_exposure_allowlist AS allowed
      WHERE allowed.signature = fn.signature
    );

  IF v_anon_unlisted IS NOT NULL THEN
    RAISE EXCEPTION E'public SECURITY DEFINER functions executable by anon but not on the allowlist:\n  %\nRevoke the default grants in the migration (REVOKE ALL ... FROM PUBLIC, anon) or add an allowlist row with a reason.',
      v_anon_unlisted;
  END IF;

  SELECT pg_catalog.string_agg(fn.signature, E'\n  ' ORDER BY fn.signature)
  INTO v_public_unlisted
  FROM definer_exposure_functions AS fn
  WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(fn.effective_acl) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM definer_exposure_allowlist AS allowed
      WHERE allowed.signature = fn.signature
    );

  IF v_public_unlisted IS NOT NULL THEN
    RAISE EXCEPTION E'public SECURITY DEFINER functions with an EXECUTE grant to PUBLIC but not on the allowlist:\n  %\nRevoke it with REVOKE ALL ... FROM PUBLIC or add an allowlist row with a reason.',
      v_public_unlisted;
  END IF;

  SELECT pg_catalog.string_agg(allowed.signature, E'\n  ' ORDER BY allowed.signature)
  INTO v_stale
  FROM definer_exposure_allowlist AS allowed
  WHERE NOT EXISTS (
    SELECT 1 FROM definer_exposure_functions AS fn
    WHERE fn.signature = allowed.signature
  );

  IF v_stale IS NOT NULL THEN
    RAISE NOTICE E'allowlist rows with no SECURITY DEFINER function in this database (production-only, dropped, or already fixed):\n  %',
      v_stale;
  END IF;
END
$allowlist$;

-- (c) revoked functions ---------------------------------------------------
DO $revoked$
DECLARE
  v_row record;
  v_oid oid;
  v_role text;
  v_violations text[] := ARRAY[]::text[];
  v_missing text[] := ARRAY[]::text[];
BEGIN
  FOR v_row IN
    SELECT * FROM definer_exposure_revoked ORDER BY signature
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_row.signature)::oid;
    IF v_oid IS NULL THEN
      v_missing := v_missing || v_row.signature;
      CONTINUE;
    END IF;

    FOREACH v_role IN ARRAY v_row.revoked_from LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        v_violations := v_violations || (v_row.signature || ' is still executable by ' || v_role);
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS proc
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
      ) AS acl
      WHERE proc.oid = v_oid
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      v_violations := v_violations || (v_row.signature || ' still has an EXECUTE grant to PUBLIC');
    END IF;

    FOREACH v_role IN ARRAY v_row.kept_by LOOP
      IF NOT pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
        v_violations := v_violations || (v_row.signature || ' lost EXECUTE for ' || v_role);
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.cardinality(v_missing) > 0 THEN
    RAISE NOTICE 'skipped % revoked signature(s) absent from this database: %',
      pg_catalog.cardinality(v_missing), pg_catalog.array_to_string(v_missing, '; ');
  END IF;

  IF pg_catalog.cardinality(v_violations) > 0 THEN
    RAISE EXCEPTION E'revoked public SECURITY DEFINER functions regressed:\n  %',
      pg_catalog.array_to_string(v_violations, E'\n  ');
  END IF;
END
$revoked$;

-- (d) functions used by policies and views ---------------------------------
DO $helpers$
DECLARE
  v_policy_offenders text;
  v_view_offenders text;
BEGIN
  SELECT pg_catalog.string_agg(offender.description, E'\n  ' ORDER BY offender.description)
  INTO v_policy_offenders
  FROM (
    SELECT DISTINCT pg_catalog.format(
      'policy %I on %I.%I (role %s) cannot execute %s',
      policy.polname,
      namespace.nspname,
      relation.relname,
      policy_role.role_name,
      dependency.refobjid::pg_catalog.regprocedure
    ) AS description
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
      AND dependency.objid = policy.oid
      AND dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    CROSS JOIN LATERAL (
      SELECT role_row.rolname::text AS role_name
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.oid = ANY (policy.polroles)
      UNION
      SELECT public_role.role_name
      FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) AS public_role(role_name)
      WHERE 0::pg_catalog.oid = ANY (policy.polroles)
    ) AS policy_role
    WHERE namespace.nspname IN ('public', 'storage')
      AND NOT pg_catalog.has_function_privilege(
        policy_role.role_name, dependency.refobjid, 'EXECUTE'
      )
  ) AS offender;

  SELECT pg_catalog.string_agg(offender.description, E'\n  ' ORDER BY offender.description)
  INTO v_view_offenders
  FROM (
    SELECT DISTINCT pg_catalog.format(
      '%s %I.%I (role %s) cannot execute %s',
      CASE relation.relkind WHEN 'm' THEN 'materialized view' ELSE 'view' END,
      namespace.nspname,
      relation.relname,
      view_role.role_name,
      dependency.refobjid::pg_catalog.regprocedure
    ) AS description
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_rewrite AS rewrite_rule
      ON rewrite_rule.ev_class = relation.oid
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
      AND dependency.objid = rewrite_rule.oid
      AND dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    CROSS JOIN LATERAL (
      SELECT role_row.rolname::text AS role_name
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.rolname !~ '^pg_'
        AND (
          (
            relation.relkind = 'v'
            AND pg_catalog.has_any_column_privilege(role_row.oid, relation.oid, 'SELECT')
          )
          OR (relation.relkind = 'm' AND role_row.oid = relation.relowner)
        )
    ) AS view_role
    WHERE relation.relkind IN ('v', 'm')
      AND namespace.nspname IN ('public', 'storage')
      AND NOT pg_catalog.has_function_privilege(
        view_role.role_name, dependency.refobjid, 'EXECUTE'
      )
  ) AS offender;

  IF v_policy_offenders IS NOT NULL OR v_view_offenders IS NOT NULL THEN
    RAISE EXCEPTION E'functions used by policies or views are not executable by the roles that query them:\n  %\n  %\nGrant EXECUTE on the helper explicitly (GRANT EXECUTE ON FUNCTION ... TO authenticated, anon).',
      COALESCE(v_policy_offenders, '(no policy offenders)'),
      COALESCE(v_view_offenders, '(no view offenders)');
  END IF;
END
$helpers$;

ROLLBACK;
