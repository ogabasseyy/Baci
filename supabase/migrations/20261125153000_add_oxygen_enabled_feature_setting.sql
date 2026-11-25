-- Add merchant-level Oxygen payment toggle (`oxygen_enabled`) to
-- `public.merchant_feature_settings` (default OFF for new/unconfigured
-- merchants), backfill `true` for merchants with an enabled production Oxygen
-- runtime binding so existing live merchants (e.g. Ogabassey) stay active with
-- zero regression, update the closed-world feature-settings audit trigger,
-- grant authenticated column SELECT, and enforce `oxygen_enabled` inside
-- `public.oxygen_storefront_pilot_available` while exposing it on
-- `public.get_storefront_payment_settings`.

BEGIN;

ALTER TABLE public.merchant_feature_settings
  ADD COLUMN IF NOT EXISTS oxygen_enabled boolean NOT NULL DEFAULT false;

GRANT SELECT (oxygen_enabled) ON TABLE public.merchant_feature_settings
  TO authenticated;

-- Classify `oxygen_enabled` in the closed-world feature settings audit trigger
-- before running the backfill UPDATE/INSERT.
DO $audit$
DECLARE
  v_definition text;
  v_needle_list constant text := $needle$'loyalty_enabled', 'order_tracking_enabled'$needle$;
  v_needle_old constant text := $needle$'order_tracking_enabled', OLD.order_tracking_enabled,$needle$;
  v_needle_new constant text := $needle$'order_tracking_enabled', NEW.order_tracking_enabled,$needle$;
  v_needle_changed constant text := $needle$CASE WHEN OLD.order_tracking_enabled IS DISTINCT FROM NEW.order_tracking_enabled THEN 'order_tracking_enabled' END,$needle$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'private.audit_merchant_feature_settings_change_v1()'::pg_catalog.regprocedure
  );
  IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle_list, '')))
       / pg_catalog.length(v_needle_list) <> 1
     OR (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle_old, '')))
       / pg_catalog.length(v_needle_old) <> 1
     OR (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle_new, '')))
       / pg_catalog.length(v_needle_new) <> 1
     OR (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle_changed, '')))
       / pg_catalog.length(v_needle_changed) <> 1 THEN
    RAISE EXCEPTION 'feature audit classification contract changed';
  END IF;

  v_definition := pg_catalog.replace(
    v_definition,
    v_needle_list,
    $replacement$'loyalty_enabled', 'order_tracking_enabled', 'oxygen_enabled'$replacement$
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle_old,
    $replacement$'order_tracking_enabled', OLD.order_tracking_enabled,
      'oxygen_enabled', OLD.oxygen_enabled,$replacement$
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle_new,
    $replacement$'order_tracking_enabled', NEW.order_tracking_enabled,
      'oxygen_enabled', NEW.oxygen_enabled,$replacement$
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle_changed,
    $replacement$CASE WHEN OLD.order_tracking_enabled IS DISTINCT FROM NEW.order_tracking_enabled THEN 'order_tracking_enabled' END,
      CASE WHEN OLD.oxygen_enabled IS DISTINCT FROM NEW.oxygen_enabled THEN 'oxygen_enabled' END,$replacement$
  );

  EXECUTE v_definition;
END
$audit$;

-- Include `oxygen_enabled` in the storefront cache invalidation projection so
-- direct `merchant_feature_settings` updates (e.g. mobile-admin toggles) trigger
-- cache invalidation just like other public payment flags.
DO $cache_projection$
DECLARE
  v_definition text;
  v_needle constant text := $needle$'order_tracking_enabled','pay_on_delivery_enabled'$needle$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.merchant_feature_settings_public_cache_projection(public.merchant_feature_settings)'::pg_catalog.regprocedure
  );
  IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_needle, '')))
       / pg_catalog.length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'feature cache oxygen_enabled projection contract changed';
  END IF;
  EXECUTE pg_catalog.replace(
    v_definition,
    v_needle,
    $replacement$'order_tracking_enabled','oxygen_enabled','pay_on_delivery_enabled'$replacement$
  );
END
$cache_projection$;

-- Backfill `oxygen_enabled = true` only for merchants that currently have an
-- enabled production row in `oxygen_private.runtime_bindings` (preserving live
-- production merchants such as Ogabassey with zero regression). Staging-only
-- runtime bindings intentionally stay fail-closed (`false`) until toggled on
-- in merchant admin Payments settings.
CREATE OR REPLACE FUNCTION private.backfill_oxygen_enabled_v1()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  v_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.merchant_feature_settings (merchant_id, oxygen_enabled)
  SELECT b.merchant_id, true
  FROM oxygen_private.runtime_bindings AS b
  WHERE b.enabled IS TRUE
    AND b.environment = 'production'
  ON CONFLICT (merchant_id) DO UPDATE
    SET oxygen_enabled = true
    WHERE public.merchant_feature_settings.oxygen_enabled IS DISTINCT FROM true;

  PERFORM pg_catalog.set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_role, ''), true);
END
$$;

REVOKE ALL ON FUNCTION private.backfill_oxygen_enabled_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.backfill_oxygen_enabled_v1() TO service_role;

DO $oxygen_backfill$
DECLARE
  v_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  v_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  PERFORM private.backfill_oxygen_enabled_v1();

  PERFORM pg_catalog.set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_role, ''), true);
END
$oxygen_backfill$;

DROP FUNCTION IF EXISTS private.backfill_oxygen_enabled_v1();

-- Require both the merchant admin toggle (`oxygen_enabled`) AND the existing
-- runtime binding + production admission policy gates.
CREATE OR REPLACE FUNCTION public.oxygen_storefront_pilot_available(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM oxygen_private.runtime_bindings b
    JOIN oxygen_private.production_admission_policy p ON p.merchant_id = b.merchant_id
    JOIN public.merchant_feature_settings s ON s.merchant_id = b.merchant_id
    WHERE b.merchant_id = p_merchant_id
      AND b.enabled IS TRUE
      AND b.environment = 'production'
      AND s.oxygen_enabled IS TRUE
      AND (
        p.mode = 'open'
        OR (
          p.mode = 'pilot'
          AND auth.uid() IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM oxygen_private.production_pilot_customers a
            WHERE a.merchant_id = b.merchant_id
              AND a.user_id = auth.uid()
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.oxygen_storefront_pilot_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.oxygen_storefront_pilot_available(uuid) TO anon, authenticated;

-- Enforce `oxygen_enabled` for new workflows at the public workflow entrypoint
-- while keeping existing in-flight workflows recoverable after disabling Oxygen.
-- Leaves `oxygen_private.start_workflow` untouched to avoid colliding with
-- other runtime changes.
CREATE OR REPLACE FUNCTION public.oxygen_start_workflow(
  p_order_id uuid,
  p_channel text DEFAULT 'web'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.oxygen_workflows AS w
    JOIN public.customers AS c
      ON c.id = w.customer_id
     AND c.merchant_id = w.merchant_id
    WHERE w.order_id = p_order_id
      AND c.user_id = auth.uid()
  ) THEN
    RETURN oxygen_private.start_workflow(p_order_id, p_channel);
  END IF;

  SELECT o.merchant_id
  INTO v_merchant_id
  FROM public.orders AS o
  JOIN public.customers AS c
    ON c.id = o.customer_id
   AND c.merchant_id = o.merchant_id
  WHERE o.id = p_order_id
    AND c.user_id = auth.uid()
    AND o.payment_method = 'oxygen'
  FOR SHARE OF o, c;

  IF FOUND THEN
    PERFORM 1
    FROM public.merchant_feature_settings AS s
    WHERE s.merchant_id = v_merchant_id
      AND s.oxygen_enabled IS TRUE
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN oxygen_private.start_workflow(p_order_id, p_channel);
END;
$$;

REVOKE ALL ON FUNCTION public.oxygen_start_workflow(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oxygen_start_workflow(uuid, text) TO authenticated;

-- Extend `get_storefront_payment_settings` with `oxygen_enabled` appended at the
-- end of RETURNS TABLE so existing positional callers remain unaffected.
DROP FUNCTION IF EXISTS public.get_storefront_payment_settings(uuid);
CREATE FUNCTION public.get_storefront_payment_settings(
  p_merchant_id uuid
) RETURNS TABLE(
  paystack_enabled boolean,
  korapay_enabled boolean,
  juicyway_enabled boolean,
  credpal_enabled boolean,
  credit_direct_enabled boolean,
  klump_enabled boolean,
  pay_on_delivery_enabled boolean,
  vat_registration_status text,
  vat_rate numeric,
  klump_min_amount numeric,
  klump_max_amount numeric,
  wallet_paystack_dva_enabled boolean,
  wallet_order_auto_debit_enabled boolean,
  shipping_insurance_enabled boolean,
  oxygen_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    COALESCE(s.paystack_enabled, true) AS paystack_enabled,
    COALESCE(s.korapay_enabled, false) AS korapay_enabled,
    COALESCE(s.juicyway_enabled, false) AS juicyway_enabled,
    COALESCE(s.credpal_enabled, false) AS credpal_enabled,
    COALESCE(s.credit_direct_enabled, false) AS credit_direct_enabled,
    COALESCE(s.klump_enabled, false) AS klump_enabled,
    COALESCE(s.pay_on_delivery_enabled, false) AS pay_on_delivery_enabled,
    COALESCE(m.vat_registration_status, 'not_registered') AS vat_registration_status,
    COALESCE(m.vat_rate, 7.5) AS vat_rate,
    COALESCE(s.klump_min_amount, 10000) AS klump_min_amount,
    COALESCE(s.klump_max_amount, 1000000) AS klump_max_amount,
    COALESCE(s.wallet_paystack_dva_enabled, false) AS wallet_paystack_dva_enabled,
    COALESCE(s.wallet_order_auto_debit_enabled, false) AS wallet_order_auto_debit_enabled,
    COALESCE(s.shipping_insurance_enabled, false) AS shipping_insurance_enabled,
    COALESCE(s.oxygen_enabled, false) AS oxygen_enabled
  FROM public.merchants m
  LEFT JOIN public.merchant_feature_settings s ON s.merchant_id = m.id
  WHERE m.id = p_merchant_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_storefront_payment_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_payment_settings(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
