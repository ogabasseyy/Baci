-- A bounded, redacted merchant-operations read model for platform admins.
-- The function is the only cross-tenant merchant-detail path. It never returns
-- people-level contact/account records, payout/bank/credential data, raw errors,
-- request metadata, or audit before/after values.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_merchant_360(p_merchant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_merchant record;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'merchants.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT merchant.id, merchant.business_name, merchant.slug, merchant.signup_source,
    merchant.plan_tier, merchant.is_published, merchant.created_at, merchant.updated_at,
    merchant.user_id, merchant.self_fulfillment_enabled, merchant.payout_currency, merchant.paystack_subaccount_code
  INTO v_merchant
  FROM public.merchants AS merchant
  WHERE merchant.id = p_merchant_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'generatedAt', pg_catalog.statement_timestamp(),
    'moneyCurrency', CASE
      WHEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK')) ~ '^[A-Z]{3}$'
        THEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK'))
      ELSE 'UNK'
    END,
    'merchant', pg_catalog.jsonb_build_object(
      'id', v_merchant.id, 'businessName', v_merchant.business_name,
      'slug', v_merchant.slug, 'signupSource', v_merchant.signup_source,
      'planTier', v_merchant.plan_tier, 'isPublished', v_merchant.is_published,
      'createdAt', v_merchant.created_at, 'updatedAt', v_merchant.updated_at
    ),
    'domain', pg_catalog.jsonb_build_object(
      'hasPrimary', primary_domain.id IS NOT NULL, 'primaryDomain', primary_domain.domain,
      'status', primary_domain.status, 'sslStatus', primary_domain.ssl_status,
      'verifiedAt', primary_domain.verified_at
    ),
    'readiness', pg_catalog.jsonb_build_object(
      'hasStorefrontSlug', NULLIF(pg_catalog.btrim(v_merchant.slug), '') IS NOT NULL,
      'isPublished', COALESCE(v_merchant.is_published, FALSE),
      'paymentConfigured', payment_configuration.configured,
      'shippingConfigured', shipping_configuration.configured,
      'storefrontReady', NULLIF(pg_catalog.btrim(v_merchant.slug), '') IS NOT NULL
        AND COALESCE(v_merchant.is_published, FALSE) AND payment_configuration.configured
        AND shipping_configuration.configured AND primary_domain.verified_at IS NOT NULL
        AND primary_domain.status = 'active' AND primary_domain.ssl_status = 'active'
    ),
    'summary', pg_catalog.jsonb_build_object(
      'webUsers', user_summary.total_web_users,
      'staffUsers', user_summary.active_staff_users, 'customerUsers', user_summary.customer_users,
      'activeAdminAppInstallations', app_summary.active_admin_installations,
      'activeStorefrontAppInstallations', app_summary.active_storefront_installations,
      'unmatchedAppUsers', app_summary.unmatched_app_users
    ),
    'staffAccess', staff_access_summary.access,
    'sales', pg_catalog.jsonb_build_object('paidGmv', paid_sales.paid_gmv,
      'paidOrders', paid_sales.paid_orders, 'lastPaidAt', paid_sales.last_paid_at),
    'settlements', pg_catalog.jsonb_build_object(
      'pendingCount', settlement_summary.pending_count, 'pendingAmount', settlement_summary.pending_amount,
      'failedCount', settlement_summary.failed_count, 'failedAmount', settlement_summary.failed_amount,
      'settledCount', settlement_summary.settled_count, 'settledAmount', settlement_summary.settled_amount
    ),
    'payouts', pg_catalog.jsonb_build_object(
      'pendingCount', payout_summary.pending_count, 'pendingAmount', payout_summary.pending_amount,
      'failedCount', payout_summary.failed_count, 'failedAmount', payout_summary.failed_amount,
      'completedCount', payout_summary.completed_count, 'completedAmount', payout_summary.completed_amount
    ),
    'incidents', pg_catalog.jsonb_build_object(
      'domainEventFailures30d', incident_summary.domain_event_failures_30d,
      'eventDeliveryDeadLetters30d', incident_summary.event_delivery_dead_letters_30d,
      'shipmentFailures30d', incident_summary.shipment_failures_30d
    ),
    'recentAuditEvents', audit_summary.events
  )
  INTO v_result
  FROM (VALUES (1)) AS singleton(value)
  LEFT JOIN LATERAL (
    SELECT d.id, d.domain, d.status, d.ssl_status, d.verified_at
    FROM public.domains AS d
    WHERE d.merchant_id = v_merchant.id AND d.is_primary IS TRUE
    ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST
    LIMIT 1
  ) AS primary_domain ON TRUE
  CROSS JOIN LATERAL (
    SELECT COALESCE(pg_catalog.bool_or(credential.is_active IS TRUE
      AND credential.disabled_at IS NULL), FALSE) AS configured
    FROM private.merchant_payment_credentials AS credential
    WHERE credential.merchant_id = v_merchant.id
  ) AS private_payment_credentials
  CROSS JOIN LATERAL (
    SELECT (private_payment_credentials.configured
      OR COALESCE(feature_settings.korapay_enabled, FALSE) OR COALESCE(feature_settings.pay_on_delivery_enabled, FALSE)
      OR (COALESCE(feature_settings.paystack_enabled, FALSE) AND NULLIF(BTRIM(v_merchant.paystack_subaccount_code), '') IS NOT NULL)) AS configured
    FROM (VALUES (1)) AS configuration_seed(value)
    LEFT JOIN LATERAL (
      SELECT settings.paystack_enabled, settings.korapay_enabled, settings.pay_on_delivery_enabled
      FROM public.merchant_feature_settings AS settings
      WHERE settings.merchant_id = v_merchant.id
      LIMIT 1
    ) AS feature_settings ON TRUE
  ) AS payment_configuration
  CROSS JOIN LATERAL (
    SELECT COALESCE(v_merchant.self_fulfillment_enabled, FALSE) OR EXISTS (
      SELECT 1 FROM public.merchant_shipping_rates AS shipping_rate
      INNER JOIN public.merchant_shipping_zones AS shipping_zone
        ON shipping_zone.id = shipping_rate.zone_id
        AND shipping_zone.merchant_id = shipping_rate.merchant_id
      WHERE shipping_rate.merchant_id = v_merchant.id
        AND shipping_rate.active IS TRUE AND shipping_zone.active IS TRUE
    ) AS configured
  ) AS shipping_configuration
  CROSS JOIN LATERAL (
    SELECT pg_catalog.count(DISTINCT identity.user_id)::bigint AS total_web_users,
      pg_catalog.count(DISTINCT identity.user_id) FILTER (WHERE identity.kind = 'staff')::bigint AS active_staff_users,
      pg_catalog.count(DISTINCT identity.user_id) FILTER (WHERE identity.kind = 'customer')::bigint AS customer_users
    FROM (
      SELECT v_merchant.user_id AS user_id, 'owner'::text AS kind
      UNION ALL SELECT staff_member.user_id, 'staff'::text FROM public.staff_members AS staff_member
        WHERE staff_member.merchant_id = v_merchant.id AND staff_member.status = 'active'
      UNION ALL SELECT customer.user_id, 'customer'::text FROM public.customers AS customer
        WHERE customer.merchant_id = v_merchant.id AND customer.deleted_at IS NULL
    ) AS identity
    WHERE identity.user_id IS NOT NULL
  ) AS user_summary
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('role', grouped_staff.role,
          'status', grouped_staff.status, 'users', grouped_staff.users)
        ORDER BY grouped_staff.role, grouped_staff.status
      ),
      '[]'::jsonb
    ) AS access
    FROM (
      SELECT staff_member.role::text AS role, staff_member.status,
        pg_catalog.count(*)::bigint AS users
      FROM public.staff_members AS staff_member
      WHERE staff_member.merchant_id = v_merchant.id
      GROUP BY staff_member.role, staff_member.status
    ) AS grouped_staff
  ) AS staff_access_summary
  CROSS JOIN LATERAL (
    SELECT pg_catalog.count(*) FILTER (WHERE push_token.is_active IS TRUE
        AND push_token.app_type = 'admin')::bigint AS active_admin_installations,
      pg_catalog.count(*) FILTER (WHERE push_token.is_active IS TRUE
        AND push_token.app_type = 'storefront')::bigint AS active_storefront_installations,
      pg_catalog.count(DISTINCT push_token.user_id) FILTER (
        WHERE push_token.user_id IS NOT NULL
          AND push_token.is_active IS TRUE
          AND push_token.user_id IS DISTINCT FROM v_merchant.user_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.staff_members AS known_staff
            WHERE known_staff.merchant_id = v_merchant.id
              AND known_staff.user_id = push_token.user_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.customers AS known_customer
            WHERE known_customer.merchant_id = v_merchant.id
              AND known_customer.user_id = push_token.user_id
              AND known_customer.deleted_at IS NULL
          )
      )::bigint AS unmatched_app_users
    FROM public.push_tokens AS push_token
    WHERE push_token.merchant_id = v_merchant.id
  ) AS app_summary
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(pg_catalog.sum(COALESCE(order_row.total, 0)), 0)::numeric AS paid_gmv,
      pg_catalog.count(*)::bigint AS paid_orders,
      pg_catalog.max(order_row.created_at) AS last_paid_at
    FROM public.orders AS order_row
    WHERE order_row.merchant_id = v_merchant.id
      AND order_row.payment_status = 'paid'
      AND UPPER(COALESCE(NULLIF(pg_catalog.btrim(order_row.currency), ''), 'UNK')) =
        CASE
          WHEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK')) ~ '^[A-Z]{3}$'
            THEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK'))
          ELSE 'UNK'
        END
  ) AS paid_sales
  CROSS JOIN LATERAL (
    SELECT pg_catalog.count(*) FILTER (WHERE settlement.status IN ('pending', 'processing'))::bigint AS pending_count,
      COALESCE(pg_catalog.sum(settlement.net_amount) FILTER (WHERE settlement.status IN ('pending', 'processing')), 0)::numeric AS pending_amount,
      pg_catalog.count(*) FILTER (WHERE settlement.status = 'failed')::bigint AS failed_count,
      COALESCE(pg_catalog.sum(settlement.net_amount) FILTER (WHERE settlement.status = 'failed'), 0)::numeric AS failed_amount,
      pg_catalog.count(*) FILTER (WHERE settlement.status = 'settled')::bigint AS settled_count,
      COALESCE(pg_catalog.sum(settlement.net_amount) FILTER (WHERE settlement.status = 'settled'), 0)::numeric AS settled_amount
    FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = v_merchant.id
  ) AS settlement_summary
  CROSS JOIN LATERAL (
    SELECT
      pg_catalog.count(*) FILTER (
        WHERE payout.status IN ('pending', 'processing')
      )::bigint AS pending_count,
      COALESCE(pg_catalog.sum(payout.amount) FILTER (
        WHERE payout.status IN ('pending', 'processing')
      ), 0)::numeric AS pending_amount,
      pg_catalog.count(*) FILTER (
        WHERE payout.status = 'failed'
      )::bigint AS failed_count,
      COALESCE(pg_catalog.sum(payout.amount) FILTER (
        WHERE payout.status = 'failed'
      ), 0)::numeric AS failed_amount,
      pg_catalog.count(*) FILTER (
        WHERE payout.status = 'completed'
      )::bigint AS completed_count,
      COALESCE(pg_catalog.sum(payout.amount) FILTER (
        WHERE payout.status = 'completed'
      ), 0)::numeric AS completed_amount
    FROM public.payout_requests AS payout
    WHERE payout.merchant_id = v_merchant.id
      AND UPPER(COALESCE(NULLIF(pg_catalog.btrim(payout.currency), ''), 'UNK')) =
        CASE
          WHEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK')) ~ '^[A-Z]{3}$'
            THEN UPPER(COALESCE(NULLIF(pg_catalog.btrim(v_merchant.payout_currency), ''), 'UNK'))
          ELSE 'UNK'
        END
  ) AS payout_summary
  CROSS JOIN LATERAL (
    SELECT
      (
        SELECT pg_catalog.count(*)::bigint
        FROM public.domain_event_failures AS failure
        WHERE failure.merchant_id = v_merchant.id
          AND failure.last_failed_at >= pg_catalog.statement_timestamp() - INTERVAL '30 days'
      ) AS domain_event_failures_30d,
      (
        SELECT pg_catalog.count(*)::bigint
        FROM public.event_deliveries AS delivery
        INNER JOIN public.domain_event_ledger AS event_ledger
          ON event_ledger.domain_event_id = delivery.domain_event_id
        WHERE event_ledger.merchant_id = v_merchant.id
          AND delivery.dead_lettered_at >= pg_catalog.statement_timestamp() - INTERVAL '30 days'
      ) AS event_delivery_dead_letters_30d,
      (
        SELECT pg_catalog.count(*)::bigint
        FROM public.shipments AS shipment
        WHERE shipment.merchant_id = v_merchant.id
          AND shipment.status IN ('failed', 'returned')
          AND shipment.updated_at >= pg_catalog.statement_timestamp() - INTERVAL '30 days'
      ) AS shipment_failures_30d
  ) AS incident_summary
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'action', audit_event.action,
          'resourceType', audit_event.resource_type,
          'changedFields', audit_event.changed_fields,
          'occurredAt', audit_event.occurred_at
        )
        ORDER BY audit_event.occurred_at DESC, audit_event.id DESC
      ),
      '[]'::jsonb
    ) AS events
    FROM (
      SELECT event.id, event.action, event.resource_type, event.changed_fields, event.occurred_at
      FROM public.audit_events AS event
      WHERE event.merchant_id = v_merchant.id
      ORDER BY event.occurred_at DESC, event.id DESC
      LIMIT 10
    ) AS audit_event
  ) AS audit_summary;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_merchant_360(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_360(uuid)
  TO authenticated;

-- The previous all-merchant profile aggregate is unused and returned bank and
-- payout identifiers. Leave the function defined for generated-client
-- compatibility, but remove all browser-callable execution paths.
REVOKE ALL ON FUNCTION public.get_admin_merchant_profiles()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_merchant_360(uuid) IS
  'Permission-gated redacted merchant operations snapshot. Excludes people-level identifiers, customer PII, bank details, payment credentials, raw errors, and audit values.';

COMMIT;
