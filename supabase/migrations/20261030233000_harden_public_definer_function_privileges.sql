-- Close the default-privilege root cause behind the public SECURITY DEFINER
-- exposure found on 30 Oct 2026, and drop public EXECUTE that no caller needs.
--
-- Root cause: production default privileges grant EXECUTE on functions created
-- by postgres in schema public to anon, authenticated and service_role (the
-- baseline migration carries the same lines), and PostgreSQL's built-in default
-- adds PUBLIC. A migration that DROPs and re-CREATEs a function and only runs
-- REVOKE ... FROM PUBLIC leaves the direct anon and authenticated grants, so
-- the function stays callable at /rest/v1/rpc/<fn>. Two wallet RPCs carried
-- unintended grants of this kind; each has its own targeted fix.
--
-- 1. Default privileges. Revoke EXECUTE from anon and authenticated for
--    functions postgres creates in public, and from PUBLIC for functions it
--    creates anywhere (a per-schema REVOKE ... FROM PUBLIC cannot remove the
--    global default). service_role and postgres keep their grants. The
--    defaults of supabase_admin are left alone: it is a managed role that
--    migrations never create objects as, and postgres cannot change them.
-- 2. Revoke EXECUTE on 62 public SECURITY DEFINER functions that a read-only
--    production triage of the 159 functions executable with the anon key found
--    to have no anon caller: 32 from PUBLIC, anon and authenticated (27
--    trigger functions, which fire without EXECUTE, and 5 internal helpers),
--    and 30 from PUBLIC and anon (authenticated keeps the grant its callers
--    use). Every entry was re-checked against origin/main callers, and the SQL
--    suites run against the migrated replay. get_storefront_cluster_guide_
--    candidates_v1 and create_storefront_order_with_loyalty_code stay as they
--    are because existing suites pin their anon EXECUTE grants. The legacy
--    preview_receipt_claim(text) stays too: production pg_stat_statements
--    shows 7 anon calls (2026-10-22..10-31) from an old client, so it keeps
--    its grants until those callers are gone. Triage items marked keep,
--    investigate or add_authorization_check are not changed; the suite
--    supabase/tests/public_definer_function_exposure.sql pins them on an
--    explicit allowlist.
--
-- Behaviour change for future functions: new functions created by postgres no
-- longer receive EXECUTE for PUBLIC, anon or authenticated. A function called
-- from the browser, the mobile apps or an RLS policy needs an explicit GRANT
-- EXECUTE, for example TO authenticated, service_role. This also applies to
-- private.* helpers, functions used in policies or column defaults, and
-- extension functions created after this migration. Existing functions keep
-- their privileges apart from the revokes below.
--
-- The statements are idempotent. Every named function exists in the history
-- replay database and in production at the signatures below.

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Trigger functions (RETURNS trigger) fire without EXECUTE; only service_role keeps it.
REVOKE ALL ON FUNCTION public.blog_media_guard_direct_row_references() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_media_guard_direct_row_references() TO service_role;
REVOKE ALL ON FUNCTION public.bound_authenticated_paystack_alias_timestamps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bound_authenticated_paystack_alias_timestamps() TO service_role;
REVOKE ALL ON FUNCTION public.correct_manual_order_document_dates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_manual_order_document_dates() TO service_role;
REVOKE ALL ON FUNCTION public.create_merchant_rest_of_world_zone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_merchant_rest_of_world_zone() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_jumia_active_shop_connection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_jumia_active_shop_connection() TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_order_fulfillment_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_order_fulfillment_notification() TO service_role;
REVOKE ALL ON FUNCTION public.expire_terminal_order_paystack_dva_aliases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_terminal_order_paystack_dva_aliases() TO service_role;
REVOKE ALL ON FUNCTION public.guard_agentic_paystack_dva_alias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_agentic_paystack_dva_alias() TO service_role;
REVOKE ALL ON FUNCTION public.guard_merchant_wallet_paystack_dva_alias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_merchant_wallet_paystack_dva_alias() TO service_role;
REVOKE ALL ON FUNCTION public.guard_order_paystack_dva_alias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_order_paystack_dva_alias() TO service_role;
REVOKE ALL ON FUNCTION public.guard_wallet_paystack_dva_alias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_wallet_paystack_dva_alias() TO service_role;
REVOKE ALL ON FUNCTION public.mark_generated_manual_order_document_dates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_generated_manual_order_document_dates() TO service_role;
REVOKE ALL ON FUNCTION public.prevent_rest_of_world_zone_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_rest_of_world_zone_delete() TO service_role;
REVOKE ALL ON FUNCTION public.prevent_rest_of_world_zone_disable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_rest_of_world_zone_disable() TO service_role;
REVOKE ALL ON FUNCTION public.prevent_rest_of_world_zone_location() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_rest_of_world_zone_location() TO service_role;
REVOKE ALL ON FUNCTION public.prevent_used_discount_code_identity_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_used_discount_code_identity_mutation() TO service_role;
REVOKE ALL ON FUNCTION public.quiz_enforce_identity_attempt_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_enforce_identity_attempt_cap() TO service_role;
REVOKE ALL ON FUNCTION public.refresh_pending_shipment_notification_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pending_shipment_notification_snapshot() TO service_role;
REVOKE ALL ON FUNCTION public.reject_cross_order_paystack_dva_alias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_cross_order_paystack_dva_alias() TO service_role;
REVOKE ALL ON FUNCTION public.release_loyalty_claims_on_order_cancel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_loyalty_claims_on_order_cancel() TO service_role;
REVOKE ALL ON FUNCTION public.reset_order_notification_dispatch_boundary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_order_notification_dispatch_boundary() TO service_role;
REVOKE ALL ON FUNCTION public.rotate_order_fulfillment_notification_cycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_order_fulfillment_notification_cycle() TO service_role;
REVOKE ALL ON FUNCTION public.set_shipping_zone_location_merchant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_shipping_zone_location_merchant_id() TO service_role;
REVOKE ALL ON FUNCTION public.snapshot_paystack_order_alias_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_paystack_order_alias_email() TO service_role;
REVOKE ALL ON FUNCTION public.sync_manual_order_document_dates_on_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_manual_order_document_dates_on_update() TO service_role;
REVOKE ALL ON FUNCTION public.validate_customer_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_customer_username() TO service_role;
REVOKE ALL ON FUNCTION public.version_active_paystack_alias_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.version_active_paystack_alias_snapshot() TO service_role;

-- Internal helpers and worker RPCs with no anon or authenticated caller.
-- commerce_cart_prepare_checkout keeps its explicit commerce_cart_shopper grant.
REVOKE ALL ON FUNCTION public.commerce_cart_prepare_checkout(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_prepare_checkout(uuid, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.select_abandoned_paystack_attempt_candidates_v1(
  integer, timestamp with time zone, timestamp with time zone
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_abandoned_paystack_attempt_candidates_v1(
  integer, timestamp with time zone, timestamp with time zone
)
  TO service_role;
REVOKE ALL ON FUNCTION public.select_completed_paystack_cancellation_refund_candidates_v1(
  integer, timestamp with time zone, integer
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_completed_paystack_cancellation_refund_candidates_v1(
  integer, timestamp with time zone, integer
)
  TO service_role;
REVOKE ALL ON FUNCTION public.select_pending_paystack_cancellation_refund_candidates_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_pending_paystack_cancellation_refund_candidates_v1(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.verify_payment_reference_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_payment_reference_token(text, text) TO service_role;

-- Signed-in callers keep EXECUTE; anon has no working path (auth, token or signed-JWT
-- gates inside, and every caller uses an authenticated or service client).
REVOKE ALL ON FUNCTION public.begin_order_notification_outbox_dispatch(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_order_notification_outbox_dispatch(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_customer_on_phone_auth(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_customer_on_phone_auth(uuid, uuid, text, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_jumia_self_authorization_discovery(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_jumia_self_authorization_discovery(uuid, uuid, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_order_notification_outbox_manual_result(
  uuid, uuid, text, text, text, text, uuid, text
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_order_notification_outbox_manual_result(
  uuid, uuid, text, text, text, text, uuid, text
)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_jumia_self_authorization_discovery(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_jumia_self_authorization_discovery(uuid, uuid, text, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_merchant_ads_oauth_state_nonce(text, uuid, uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_jumia_self_authorization_discovery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_jumia_self_authorization_discovery(uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_order_wallet_funding_intent_for_customer(
  uuid, uuid, uuid, uuid, timestamp with time zone
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_wallet_funding_intent_for_customer(
  uuid, uuid, uuid, uuid, timestamp with time zone
)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb, text, text,
  jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb, text, text,
  jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text
)
  TO authenticated, service_role;
-- create_storefront_order_with_cart_binding: service_role holds no grant today and none is added.
REVOKE ALL ON FUNCTION public.create_storefront_order_with_cart_binding(text, uuid, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_cart_binding(text, uuid, integer, jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.create_storefront_order_with_discount_code(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb, text, text,
  jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text, uuid
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_discount_code(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb, text, text,
  jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text, uuid
)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_legacy_expense_receipt(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.expire_order_wallet_funding_intents(uuid, uuid, uuid, timestamp with time zone)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_order_wallet_funding_intents(uuid, uuid, uuid, timestamp with time zone)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_notification_outbox_manual_terminal_status(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_notification_outbox_manual_terminal_status(uuid, uuid, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_payment_snapshot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_payment_snapshot(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_product_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_offers(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_record_payment_order_transactions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_record_payment_order_transactions(uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_authenticated_admin_gigl_quote(jsonb, jsonb, jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid, jsonb, jsonb)
  TO authenticated, service_role;
-- persist_storefront_order_delivery_metadata: service_role holds no grant today and none is added.
REVOKE ALL ON FUNCTION public.persist_storefront_order_delivery_metadata(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_storefront_order_delivery_metadata(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_order_notification_outbox_manual_send(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_order_notification_outbox_manual_send(uuid, uuid, text, text, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.queue_expense_private_receipt_cleanup(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_expense_private_receipt_cleanup(uuid, uuid, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(uuid, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_manual_order_payment(uuid, uuid, numeric, text, text, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_order_payment(uuid, uuid, numeric, text, text, text, jsonb, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_jumia_self_authorization_discovery(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_jumia_self_authorization_discovery(uuid, uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_merchant_ads_oauth_state_nonce(
  text, uuid, uuid, text, text, timestamp with time zone
)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_ads_oauth_state_nonce(
  text, uuid, uuid, text, text, timestamp with time zone
)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text, timestamp with time zone)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_snapchat_ads_oauth_state_nonce(uuid, uuid, text, text, timestamp with time zone)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_order_notification_outbox_dispatch(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_order_notification_outbox_dispatch(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_claimed_jumia_self_authorization_discovery(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_claimed_jumia_self_authorization_discovery(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMIT;
