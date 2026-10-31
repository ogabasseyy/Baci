-- Include-only part of public_definer_function_exposure.sql (no BEGIN/ROLLBACK): the
-- entry point owns the transaction and loads this file with \ir.
--
-- (c) The functions revoked by the migration are not executable by the revoked
-- roles and still executable by the roles that keep them. A signature missing
-- from this database is skipped with a NOTICE (production-only functions).

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

