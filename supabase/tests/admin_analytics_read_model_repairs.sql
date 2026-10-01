-- REGRESSION TEST: platform-admin analytics read-model repairs.
--
-- Run in an isolated PostgreSQL database:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/admin_analytics_read_model_repairs.sql

BEGIN;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$;
CREATE FUNCTION private.has_platform_admin_permission_v1(uuid, text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT TRUE; $$;

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY, slug text, business_name text, email text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), payout_currency text
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid, total numeric, currency text,
  payment_status text, created_at timestamptz
);
CREATE TABLE public.merchant_settlements (
  id uuid PRIMARY KEY, merchant_id uuid, status text, net_amount numeric,
  gateway text, created_at timestamptz
);
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY, merchant_id uuid, amount numeric, currency text,
  transaction_type text, status text, gateway text, created_at timestamptz
);
CREATE TABLE public.payout_requests (
  id uuid PRIMARY KEY, merchant_id uuid, amount numeric, currency text,
  status text, created_at timestamptz
);
CREATE TABLE public.merchant_wallets (
  merchant_id uuid PRIMARY KEY, available_balance numeric, pending_balance numeric,
  upcoming_balance numeric
);
CREATE TABLE public.reconciliation_review (
  id uuid PRIMARY KEY, merchant_id uuid, issue_type text, resolved_at timestamptz,
  created_at timestamptz
);
CREATE TABLE public.email_send_attempts (
  id uuid PRIMARY KEY, merchant_id uuid, provider text, email_type text,
  provider_error_code text, attempt_count integer, status text,
  created_at timestamptz, updated_at timestamptz
);
CREATE TABLE public.push_notification_attempts (
  id uuid PRIMARY KEY, status text, created_at timestamptz
);
CREATE TABLE public.order_notification_outbox (status text, locked_at timestamptz);
CREATE TABLE public.shipment_tracking_notification_outbox (status text, locked_at timestamptz);
CREATE TABLE public.admin_notification_audience_snapshot (
  notification_id uuid NOT NULL, claim_token uuid NOT NULL, merchant_id uuid NOT NULL,
  PRIMARY KEY (notification_id, claim_token, merchant_id)
);
CREATE TABLE public.platform_admin_memberships (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, granted_by uuid, revoked_by uuid
);
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY, merchant_id uuid, order_id uuid, provider text,
  status text, updated_at timestamptz
);
CREATE TABLE public.shipping_webhook_events (
  id uuid PRIMARY KEY, processed boolean, error text, created_at timestamptz
);

CREATE FUNCTION public.get_admin_merchant_360(uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'moneyCurrency', CASE
      WHEN $1 = '00000000-0000-0000-0000-000000000011'::uuid THEN 'UNK'
      ELSE 'NGN'
    END,
    'readiness', jsonb_build_object(
      'hasStorefrontSlug', TRUE, 'isPublished', TRUE,
      'paymentConfigured', TRUE, 'shippingConfigured', TRUE,
      'storefrontReady', FALSE
    ),
    'domain', jsonb_build_object('verifiedAt', NULL, 'status', 'pending', 'sslStatus', 'pending')
  );
$$;
CREATE FUNCTION public.get_admin_system_health_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('health', jsonb_build_array(
    jsonb_build_object(
      'check_name', 'Notification delivery', 'status', 'warning',
      'message', 'Legacy status', 'details', '{}'::jsonb
    ),
    jsonb_build_object(
      'check_name', 'Shipping operations', 'status', 'warning',
      'message', 'Legacy shipping status', 'details', '{}'::jsonb
    )
  ));
$$;
CREATE FUNCTION public.get_admin_operations_v1(text, integer, integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'financial', jsonb_build_object('settlements', jsonb_build_array(
      jsonb_build_object(
        'createdAt', clock_timestamp(), 'currency', 'UNK',
        'expectedSettlementDate', '2026-08-09', 'gateway', 'paystack',
        'id', '00000000-0000-0000-0000-000000000030',
        'merchantId', '00000000-0000-0000-0000-000000000010',
        'merchantName', 'First merchant', 'netAmount', 95, 'status', 'failed'
      )
    )),
    'summary', jsonb_build_object('notifications', 0),
    'notifications', jsonb_build_object('email', '[]'::jsonb)
  );
$$;
-- Minimal delegates required to replay the production v2 error-code projection
-- migration. The test exercises get_admin_operations_v2; these other v2
-- readers only satisfy the migration's ACL and wrapper dependencies.
CREATE FUNCTION public.list_event_pipeline_ingress_failures_admin_v2(
  integer, integer, text, uuid, timestamptz, timestamptz
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('items', '[]'::jsonb);
$$;
CREATE FUNCTION public.list_event_pipeline_deliveries_admin_v2(
  text, integer, integer, text, text, uuid, timestamptz, timestamptz
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('items', '[]'::jsonb);
$$;
CREATE FUNCTION public.get_event_pipeline_operations_admin_v2()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('heartbeats', '[]'::jsonb);
$$;
CREATE FUNCTION public.write_platform_audit_event_v1(text, text, text, text[], jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN END; $$;

INSERT INTO public.merchants (id, slug, business_name, email, payout_currency)
VALUES
  ('00000000-0000-0000-0000-000000000010', 'first', 'First merchant', 'first@example.test', 'NGN'),
  ('00000000-0000-0000-0000-000000000011', 'second', 'Second merchant', 'second@example.test', 'NGN');
INSERT INTO public.orders (id, merchant_id, total, currency, payment_status, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 100, 'NGN', 'paid', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 200, 'NGN', 'paid', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000011', 300, NULL, 'paid', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000011', 400, '  ', 'paid', clock_timestamp());
INSERT INTO public.merchant_settlements (id, merchant_id, status, net_amount, gateway, created_at)
VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'pending', 95, 'paystack', clock_timestamp());
INSERT INTO public.payout_requests (id, merchant_id, amount, currency, status, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000010', 40, 'USD', 'completed', clock_timestamp()),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000010', 25, 'NGN', 'pending', clock_timestamp());
INSERT INTO public.email_send_attempts (
  id, merchant_id, provider, email_type, attempt_count, status, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000010',
  'zeptomail', 'order_confirmation', 1, 'failed',
  clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
);
INSERT INTO public.push_notification_attempts (id, status, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000050', 'failed',
  clock_timestamp() - interval '2 days'
);
INSERT INTO public.shipments (id, merchant_id, provider, status, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000060',
  '00000000-0000-0000-0000-000000000010', 'GIGL', 'returned',
  clock_timestamp() - interval '2 days'
);

\ir ../migrations/20260809154414_repair_admin_analytics_read_models.sql
\ir ../migrations/20260809154415_repair_admin_merchant_360_readiness.sql
\ir ../migrations/20260809154416_repair_admin_reconciliation_currencyless_activity.sql
\ir ../migrations/20260809154417_repair_admin_system_health_email_freshness.sql
\ir ../migrations/20260809154917_repair_admin_operations_stale_email_attempts.sql
\ir ../migrations/20260809170137_repair_admin_push_health_and_audience_snapshot_index.sql
\ir ../migrations/20260805151570_harden_admin_error_code_projections.sql
\ir ../migrations/20260809173000_repair_admin_operations_currency_and_health_indexes.sql
\ir ../migrations/20260809173100_index_platform_admin_membership_actors.sql
\ir ../migrations/20260809173200_repair_admin_merchant_360_unknown_currency_gmv.sql
\ir ../migrations/20260811124500_repair_admin_merchant_360_payout_history_and_shipments.sql

-- The production v2 projection migration commits its own transaction.
BEGIN;

DO $$
DECLARE
  v_directory_id uuid;
  v_detail jsonb;
  v_unknown_currency_detail jsonb;
  v_reconciliation jsonb;
  v_health jsonb;
  v_operations jsonb;
BEGIN
  SELECT merchant_id INTO v_directory_id
  FROM public.get_admin_merchant_health_v2(50, 0, NULL, NULL, 'gmv')
  LIMIT 1;
  IF v_directory_id <> '00000000-0000-0000-0000-000000000011'::uuid THEN
    RAISE EXCEPTION 'merchant directory did not sort by the CTE total_gmv output';
  END IF;

  v_detail := public.get_admin_merchant_360_v2('00000000-0000-0000-0000-000000000010');
  IF (v_detail #>> '{readiness,storefrontReady}') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Merchant 360 still requires a custom domain for storefront readiness';
  END IF;
  v_unknown_currency_detail := public.get_admin_merchant_360_v2(
    '00000000-0000-0000-0000-000000000011'
  );
  IF (v_unknown_currency_detail #>> '{sales,paidGmv}') IS DISTINCT FROM '0'
    OR (v_unknown_currency_detail #>> '{sales,displayCurrencyPaidOrders}')
      IS DISTINCT FROM '0'
    OR (v_unknown_currency_detail #>> '{sales,excludedNonDisplayCurrencyPaidOrders}')
      IS DISTINCT FROM '3'
    OR (v_unknown_currency_detail #>> '{sales,paidOrders}') IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'Merchant 360 counted unknown-currency paid orders as GMV instead of excluding them';
  END IF;
  IF (v_detail #>> '{payouts,completedCount}') IS DISTINCT FROM '1'
    OR (v_detail #>> '{payouts,pendingCount}') IS DISTINCT FROM '1'
    OR (v_detail #> '{payouts,completedAmount}') IS DISTINCT FROM 'null'::jsonb
    OR (v_detail #> '{payouts,pendingAmount}') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Merchant 360 lost payout requests after a historical currency change';
  END IF;

  v_reconciliation := public.get_admin_reconciliation_v3('30d', 'NGN', NULL, 'all', 'all', NULL, NULL, 50);
  IF (v_reconciliation #>> '{metrics,platformSettlements,pendingCount}')
      IS DISTINCT FROM '1'
    OR (v_reconciliation #>> '{items,0,lane}')
      IS DISTINCT FROM 'platform_settlement'
    OR (v_reconciliation #> '{items,0,amount}') IS DISTINCT FROM 'null'::jsonb
    OR (v_reconciliation #> '{items,0,currency}') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'currency-less settlement activity was hidden or relabeled as money';
  END IF;

  v_health := public.get_admin_system_health_v1();
  IF (v_health #>> '{health,0,status}') IS DISTINCT FROM 'healthy' THEN
    RAISE EXCEPTION 'historical failed email or push still degrades system health';
  END IF;
  IF (v_health #>> '{health,1,status}') IS DISTINCT FROM 'healthy' THEN
    RAISE EXCEPTION 'historical returned shipment still degrades system health';
  END IF;
  IF to_regclass('public.admin_notification_audience_snapshot_merchant_id_idx') IS NULL THEN
    RAISE EXCEPTION 'merchant-leading notification-audience snapshot index is missing';
  END IF;
  IF to_regclass('public.platform_admin_memberships_granted_by_idx') IS NULL
    OR to_regclass('public.platform_admin_memberships_revoked_by_idx') IS NULL THEN
    RAISE EXCEPTION 'platform-admin membership actor foreign-key indexes are missing';
  END IF;

  v_operations := public.get_admin_operations_v2('financial', 25, 0);
  IF (v_operations #> '{financial,settlements,0,netAmount}')
      IS DISTINCT FROM 'null'::jsonb
    OR (v_operations #> '{financial,settlements,0,currency}')
      IS DISTINCT FROM 'null'::jsonb
    OR (v_operations #>> '{financial,settlements,0,id}')
      IS DISTINCT FROM '00000000-0000-0000-0000-000000000030'
    OR (v_operations #>> '{financial,settlements,0,status}')
      IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'operations settlement projection still exposes currencyless money or lost incident metadata';
  END IF;

  INSERT INTO public.shipments (id, merchant_id, provider, status, updated_at)
  VALUES (
    '00000000-0000-0000-0000-000000000061',
    '00000000-0000-0000-0000-000000000010', 'GIGL', 'returned', clock_timestamp()
  );
  v_health := public.get_admin_system_health_v1();
  IF (v_health #>> '{health,1,status}') IS DISTINCT FROM 'critical'
    OR (v_health #>> '{health,1,details,shipmentStatusWindow}')
      IS DISTINCT FROM '24 hours' THEN
    RAISE EXCEPTION 'recent returned shipment is absent from system health';
  END IF;

  INSERT INTO public.email_send_attempts (
    id, merchant_id, provider, email_type, attempt_count, status, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000010',
    'zeptomail', 'order_confirmation', 1, 'pending',
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes'
  );
  INSERT INTO public.email_send_attempts (
    id, merchant_id, provider, email_type, attempt_count, status, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000010',
    'zeptomail', 'order_confirmation', 1, 'pending', clock_timestamp(), clock_timestamp()
  );
  v_health := public.get_admin_system_health_v1();
  IF (v_health #>> '{health,0,status}') IS DISTINCT FROM 'warning' THEN
    RAISE EXCEPTION 'stale pending email does not degrade system health';
  END IF;
  v_health := public.get_admin_operations_v2('notifications', 25, 0);
  IF (v_health #>> '{summary,notifications}') IS DISTINCT FROM '1'
    OR (v_health #>> '{notifications,email,0,id}')
      IS DISTINCT FROM '00000000-0000-0000-0000-000000000041'
    OR (v_health #>> '{notifications,email,0,status}') IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'stale pending email is absent from operations incidents';
  END IF;
  IF v_health::text LIKE '%00000000-0000-0000-0000-000000000042%' THEN
    RAISE EXCEPTION 'fresh pending email incorrectly appears in operations incidents';
  END IF;

  DELETE FROM public.email_send_attempts
  WHERE id = '00000000-0000-0000-0000-000000000041';
  INSERT INTO public.push_notification_attempts (id, status, created_at)
  VALUES (
    '00000000-0000-0000-0000-000000000051', 'partial_failure', clock_timestamp()
  );
  v_health := public.get_admin_system_health_v1();
  IF (v_health #>> '{health,0,status}') IS DISTINCT FROM 'warning'
    OR (v_health #>> '{health,0,details,pushFailureWindow}')
      IS DISTINCT FROM '24 hours' THEN
    RAISE EXCEPTION 'fresh failed or partial push does not degrade system health';
  END IF;
END;
$$;

ROLLBACK;
