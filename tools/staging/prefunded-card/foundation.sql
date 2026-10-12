BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended('prefunded-card-foundation-install-v1', 0));

-- foundation preflight
DO $foundation_preflight$
DECLARE
  missing text[] := ARRAY[]::text[];
  labels text[] := ARRAY[]::text[];
  contribution_constraint text;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802' THEN
    labels := array_append(labels, 'foundation_conflict:physical_database');
  END IF;
  IF clock_timestamp() >= '2026-09-29T15:59:10Z'::timestamptz THEN
    labels := array_append(labels, 'foundation_expired:2026-09-29T15:59:10Z');
  END IF;
  IF to_regclass('public.merchants') IS NULL THEN missing := array_append(missing, 'public.merchants'); END IF;
  IF to_regclass('public.customers') IS NULL THEN missing := array_append(missing, 'public.customers'); END IF;
  IF to_regclass('public.customer_savings_goals') IS NULL THEN missing := array_append(missing, 'public.customer_savings_goals'); END IF;
  IF to_regclass('public.customer_savings_contributions') IS NULL THEN missing := array_append(missing, 'public.customer_savings_contributions'); END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NULL THEN missing := array_append(missing, 'public.customer_saved_payment_methods'); END IF;
  IF to_regclass('public.piggyvest_plan_wallets') IS NULL THEN missing := array_append(missing, 'public.piggyvest_plan_wallets'); END IF;
  IF to_regclass('public.transactions') IS NULL THEN missing := array_append(missing, 'public.transactions'); END IF;
  IF to_regclass('piggyvest_staging.integrations') IS NULL THEN missing := array_append(missing, 'piggyvest_staging.integrations'); END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NULL THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings'); END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NULL THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings'); END IF;
  IF to_regclass('piggyvest_savings_ledger.operations') IS NULL THEN missing := array_append(missing, 'piggyvest_savings_ledger.operations'); END IF;
  IF to_regclass('piggyvest_savings_ledger.postings') IS NULL THEN missing := array_append(missing, 'piggyvest_savings_ledger.postings'); END IF;
  IF to_regprocedure('piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)') IS NULL THEN missing := array_append(missing, 'piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)'); END IF;
  IF to_regprocedure('piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid)') IS NULL THEN missing := array_append(missing, 'piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid)'); END IF;
  IF to_regprocedure('public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamp with time zone)') IS NULL THEN missing := array_append(missing, 'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamp with time zone)'); END IF;
  IF to_regrole('anon') IS NULL THEN missing := array_append(missing, 'anon'); END IF;
  IF to_regrole('authenticated') IS NULL THEN missing := array_append(missing, 'authenticated'); END IF;
  IF to_regrole('service_role') IS NULL THEN missing := array_append(missing, 'service_role'); END IF;
  IF to_regrole('pvb_staging_app_worker') IS NULL THEN missing := array_append(missing, 'pvb_staging_app_worker'); END IF;
  IF to_regclass('public.merchants') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.merchants.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.merchants.id_type'); END IF; END IF;
  IF to_regclass('public.merchants') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'slug' AND NOT attisdropped) THEN missing := array_append(missing, 'public.merchants.slug'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'slug' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.merchants.slug_type'); END IF; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customers.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customers.id_type'); END IF; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customers.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customers.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'user_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customers.user_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'user_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customers.user_id_type'); END IF; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'email' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customers.email'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'email' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customers.email_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.customer_id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'target_amount' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.target_amount'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'target_amount' AND NOT attisdropped AND atttypid = ANY (ARRAY['numeric'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.target_amount_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'current_amount' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.current_amount'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'current_amount' AND NOT attisdropped AND atttypid = ANY (ARRAY['numeric'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.current_amount_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'goal_kind' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.goal_kind'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'goal_kind' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.goal_kind_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'source_mode' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.source_mode'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'source_mode' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.source_mode_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'status' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.status'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'status' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.status_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'completed_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.completed_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'completed_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.completed_at_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'cancelled_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.cancelled_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'cancelled_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.cancelled_at_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'spent_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.spent_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'spent_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.spent_at_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'updated_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_goals.updated_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'updated_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals.updated_at_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.customer_id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'goal_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.goal_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'goal_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.goal_id_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'amount' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.amount'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'amount' AND NOT attisdropped AND atttypid = ANY (ARRAY['numeric'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.amount_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'status' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.status'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'status' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.status_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'processed_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.processed_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'processed_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.processed_at_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'source_type' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.source_type'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'source_type' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.source_type_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'idempotency_key' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.idempotency_key'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'idempotency_key' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.idempotency_key_type'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'metadata' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_savings_contributions.metadata'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'metadata' AND NOT attisdropped AND atttypid = ANY (ARRAY['jsonb'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions.metadata_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.id_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.customer_id_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'provider' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.provider'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'provider' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.provider_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'provider_customer_email' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.provider_customer_email'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'provider_customer_email' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.provider_customer_email_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_code' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.authorization_code'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_code' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.authorization_code_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_signature' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.authorization_signature'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_signature' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.authorization_signature_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_data' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.authorization_data'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_data' AND NOT attisdropped AND atttypid = ANY (ARRAY['jsonb'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.authorization_data_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'brand' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.brand'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'brand' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.brand_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'last4' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.last4'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'last4' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.last4_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'exp_month' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.exp_month'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'exp_month' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.exp_month_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'exp_year' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.exp_year'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'exp_year' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.exp_year_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'reusable' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.reusable'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'reusable' AND NOT attisdropped AND atttypid = ANY (ARRAY['boolean'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.reusable_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'is_default' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.is_default'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'is_default' AND NOT attisdropped AND atttypid = ANY (ARRAY['boolean'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.is_default_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.is_active'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'is_active' AND NOT attisdropped AND atttypid = ANY (ARRAY['boolean'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.is_active_type'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'disabled_at' AND NOT attisdropped) THEN missing := array_append(missing, 'public.customer_saved_payment_methods.disabled_at'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'disabled_at' AND NOT attisdropped AND atttypid = ANY (ARRAY['timestamp with time zone'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods.disabled_at_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.integrations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.integrations.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.integrations.id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.integrations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'expected_provider_account_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.integrations.expected_provider_account_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'expected_provider_account_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.integrations.expected_provider_account_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.integrations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'enabled' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.integrations.enabled'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'enabled' AND NOT attisdropped AND atttypid = ANY (ARRAY['boolean'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.integrations.enabled_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'integration_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.integration_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'integration_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.integration_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.merchant_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.customer_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'goal_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.goal_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'goal_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.goal_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'provider_wallet_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.provider_wallet_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'provider_wallet_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.provider_wallet_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_staging.wallet_goal_mappings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'provider_customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_staging.wallet_goal_mappings.provider_customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_staging.wallet_goal_mappings'::regclass AND attname = 'provider_customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.wallet_goal_mappings.provider_customer_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'integration_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.integration_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'integration_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.integration_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.merchant_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.customer_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'goal_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.goal_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'goal_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.goal_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'enabled' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.enabled'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'enabled' AND NOT attisdropped AND atttypid = ANY (ARRAY['boolean'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.enabled_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'authorized_login' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.bindings.authorized_login'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'authorized_login' AND NOT attisdropped AND atttypid = ANY (ARRAY['name'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings.authorized_login_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.operations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.operations.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.operations.id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.operations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'integration_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.operations.integration_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'integration_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.operations.integration_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.operations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'goal_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.operations.goal_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'goal_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.operations.goal_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.postings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'operation_id' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.postings.operation_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'operation_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.postings.operation_id_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.postings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'account' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.postings.account'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'account' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.postings.account_type'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.postings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'amount_kobo' AND NOT attisdropped) THEN missing := array_append(missing, 'piggyvest_savings_ledger.postings.amount_kobo'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.postings'::regclass AND attname = 'amount_kobo' AND NOT attisdropped AND atttypid = ANY (ARRAY['bigint'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.postings.amount_kobo_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.id_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'gateway' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.gateway'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'gateway' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.gateway_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'transaction_type' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.transaction_type'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'transaction_type' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.transaction_type_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'status' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.status'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'status' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.status_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'currency' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.currency'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'currency' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.currency_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'gateway_reference' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.gateway_reference'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'gateway_reference' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.gateway_reference_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'metadata' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.metadata'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'metadata' AND NOT attisdropped AND atttypid = ANY (ARRAY['jsonb'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.metadata_type'); END IF; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'amount' AND NOT attisdropped) THEN missing := array_append(missing, 'public.transactions.amount'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.transactions'::regclass AND attname = 'amount' AND NOT attisdropped AND atttypid = ANY (ARRAY['numeric'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.transactions.amount_type'); END IF; END IF;
  IF to_regclass('public.piggyvest_plan_wallets') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'wallet_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.piggyvest_plan_wallets.wallet_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'wallet_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.piggyvest_plan_wallets.wallet_id_type'); END IF; END IF;
  IF to_regclass('public.piggyvest_plan_wallets') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'piggyvest_customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.piggyvest_plan_wallets.piggyvest_customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'piggyvest_customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['text'::regtype, 'character varying'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.piggyvest_plan_wallets.piggyvest_customer_id_type'); END IF; END IF;
  IF to_regclass('public.piggyvest_plan_wallets') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'customer_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.piggyvest_plan_wallets.customer_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'customer_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.piggyvest_plan_wallets.customer_id_type'); END IF; END IF;
  IF to_regclass('public.piggyvest_plan_wallets') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'merchant_id' AND NOT attisdropped) THEN missing := array_append(missing, 'public.piggyvest_plan_wallets.merchant_id'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_plan_wallets'::regclass AND attname = 'merchant_id' AND NOT attisdropped AND atttypid = ANY (ARRAY['uuid'::regtype])) THEN labels := array_append(labels, 'foundation_conflict:public.piggyvest_plan_wallets.merchant_id_type'); END IF; END IF;
  IF to_regclass('public.merchants') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.merchants'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.merchants'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:public.merchants_id_key'); END IF; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customers'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:public.customers_id_key'); END IF; END IF;
  IF to_regclass('public.customer_savings_goals') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_savings_goals'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customer_savings_goals'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_goals_id_key'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'piggyvest_savings_ledger.bindings'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'integration_id' AND NOT attisdropped), (SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'merchant_id' AND NOT attisdropped), (SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'customer_id' AND NOT attisdropped), (SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.bindings'::regclass AND attname = 'goal_id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.bindings_scope_key'); END IF; END IF;
  IF to_regclass('piggyvest_staging.integrations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'piggyvest_staging.integrations'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_staging.integrations'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_staging.integrations_id_key'); END IF; END IF;
  IF to_regclass('piggyvest_savings_ledger.operations') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'piggyvest_savings_ledger.operations'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'piggyvest_savings_ledger.operations'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:piggyvest_savings_ledger.operations_id_key'); END IF; END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_savings_contributions'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customer_savings_contributions'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:public.customer_savings_contributions_id_key'); END IF; END IF;
  IF to_regclass('public.customer_saved_payment_methods') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer_saved_payment_methods'::regclass AND contype IN ('p', 'u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'customer_id' AND NOT attisdropped), (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'provider' AND NOT attisdropped), (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customer_saved_payment_methods'::regclass AND attname = 'authorization_signature' AND NOT attisdropped)]::smallint[]) THEN labels := array_append(labels, 'foundation_conflict:public.customer_saved_payment_methods_customer_provider_signature_key'); END IF; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreaterole)) THEN
    missing := array_append(missing, 'installer_createrole');
  END IF;
  IF to_regnamespace('prefunded_card') IS NOT NULL THEN
    labels := array_append(labels, 'foundation_conflict:prefunded_card_schema');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence', 'prefunded_treasury_ledger_worker', 'prefunded_card_authorization_reader', 'prefunded_card_authorization_provisioner']::text[])
  ) THEN
    labels := array_append(labels, 'foundation_conflict:executor_role_state');
  END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN
    SELECT regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]()]|::text(\[\])?', '', 'g')
      INTO contribution_constraint
      FROM pg_constraint
      WHERE conrelid = 'public.customer_savings_contributions'::regclass
        AND conname = 'customer_savings_contributions_source_type_check';
    IF contribution_constraint IS NULL OR contribution_constraint NOT IN (
      'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'']',
      'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'',''piggyvest_inflow'']'
    ) THEN
      labels := array_append(labels, 'foundation_conflict:customer_savings_contributions_source_type_check');
    END IF;
  END IF;
  IF cardinality(missing) > 0 THEN
    SELECT array_agg('foundation_missing:' || identifier ORDER BY identifier) INTO missing FROM unnest(missing) AS identifier;
    labels := labels || missing;
  END IF;
  IF cardinality(labels) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(labels, ',');
  END IF;
END
$foundation_preflight$;

-- source: storage.sql

CREATE SCHEMA prefunded_card;
REVOKE ALL ON SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE prefunded_card.treasury_bindings (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  expected_business_id text COLLATE "C" NOT NULL,
  source_wallet_id text COLLATE "C" NOT NULL,
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  verified_available_kobo bigint NOT NULL CHECK (verified_available_kobo >= 0),
  reserved_kobo bigint NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  consumed_kobo bigint NOT NULL DEFAULT 0 CHECK (consumed_kobo >= 0),
  verified_at timestamptz NOT NULL,
  authorized_login name NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  CHECK (source_wallet_id <> ''),
  CHECK (expected_business_id <> '')
);

CREATE TABLE prefunded_card.operations (
  id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  request_fingerprint text COLLATE "C" NOT NULL,
  idempotency_key text COLLATE "C" NOT NULL,
  saved_method_id uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  fee_allowance_kobo bigint NOT NULL CHECK (fee_allowance_kobo = 0),
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  collection_reference text COLLATE "C" NOT NULL,
  transfer_reference text COLLATE "C" NOT NULL,
  destination_wallet_id text COLLATE "C" NOT NULL,
  destination_customer_id text COLLATE "C" NOT NULL,
  collection_status text NOT NULL DEFAULT 'not_started' CHECK (collection_status IN ('not_started','dispatching','action_required','pending','unknown','verified_success','verified_failed','reversed')),
  transfer_status text NOT NULL DEFAULT 'not_started' CHECK (transfer_status IN ('not_started','dispatching','pending','unknown','verified_success','verified_failed')),
  projection_status text NOT NULL DEFAULT 'unapplied' CHECK (projection_status IN ('unapplied','applied','reconciliation_required')),
  collection_fence bigint NOT NULL DEFAULT 0 CHECK (collection_fence >= 0),
  transfer_fence bigint NOT NULL DEFAULT 0 CHECK (transfer_fence >= 0),
  verification_fence bigint NOT NULL DEFAULT 0 CHECK (verification_fence >= 0),
  verification_token uuid,
  verification_lease_expires_at timestamptz,
  collection_attempted_at timestamptz,
  transfer_attempted_at timestamptz,
  collection_provider_transaction_id text COLLATE "C",
  transfer_provider_transaction_id text COLLATE "C",
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id, idempotency_key),
  UNIQUE (integration_id, collection_reference),
  UNIQUE (integration_id, transfer_reference),
  UNIQUE (integration_id, collection_provider_transaction_id),
  UNIQUE (integration_id, transfer_provider_transaction_id),
  FOREIGN KEY (integration_id, merchant_id, customer_id, goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id, merchant_id, customer_id, goal_id),
  CHECK (collection_reference <> transfer_reference),
  CHECK (destination_wallet_id <> ''),
  CHECK (destination_customer_id <> '')
);

CREATE INDEX prefunded_card_operations_goal_active_idx ON prefunded_card.operations(goal_id)
  WHERE collection_status NOT IN ('verified_failed','reversed');

ALTER TABLE prefunded_card.treasury_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_operation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'prefunded card immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['collection_status','transfer_status','projection_status','collection_fence','transfer_fence','verification_fence','verification_token','verification_lease_expires_at','collection_attempted_at','transfer_attempted_at','collection_provider_transaction_id','transfer_provider_transaction_id'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['collection_status','transfer_status','projection_status','collection_fence','transfer_fence','verification_fence','verification_token','verification_lease_expires_at','collection_attempted_at','transfer_attempted_at','collection_provider_transaction_id','transfer_provider_transaction_id']) THEN
    RAISE EXCEPTION 'prefunded card immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_card_operation_guard BEFORE UPDATE OR DELETE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_operation();
CREATE TRIGGER prefunded_card_operation_no_truncate BEFORE TRUNCATE ON prefunded_card.operations
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_operation();

CREATE FUNCTION prefunded_card.reserve(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE command prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; mapped record; existing prefunded_card.operations%ROWTYPE;
DECLARE active_goal_kobo bigint; available_goal_kobo bigint; available_float_kobo bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'prefunded reservation isolation denied' USING ERRCODE='42501';
  END IF;
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_command)) <> 16
    OR NOT p_command ?& ARRAY['operationId','integrationId','merchantId','customerId','goalId','treasuryBindingId','requestFingerprint','idempotencyKey','savedMethodId','amountKobo','feeAllowanceKobo','currency','collectionReference','transferReference','destinationWalletId','destinationCustomerId']
    OR (p_command->>'feeAllowanceKobo')::bigint <> 0 OR p_command->>'currency' <> 'NGN'
    OR (p_command->>'amountKobo')::bigint NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  command.id := (p_command->>'operationId')::uuid; command.integration_id := (p_command->>'integrationId')::uuid;
  command.merchant_id := (p_command->>'merchantId')::uuid; command.customer_id := (p_command->>'customerId')::uuid;
  command.goal_id := (p_command->>'goalId')::uuid; command.treasury_binding_id := (p_command->>'treasuryBindingId')::uuid;
  command.request_fingerprint := p_command->>'requestFingerprint'; command.idempotency_key := p_command->>'idempotencyKey';
  command.saved_method_id := (p_command->>'savedMethodId')::uuid; command.amount_kobo := (p_command->>'amountKobo')::bigint;
  command.fee_allowance_kobo := 0; command.currency := 'NGN'; command.collection_reference := p_command->>'collectionReference';
  command.transfer_reference := p_command->>'transferReference'; command.destination_wallet_id := p_command->>'destinationWalletId';
  command.destination_customer_id := p_command->>'destinationCustomerId';
  IF length(command.request_fingerprint) NOT BETWEEN 16 AND 255 OR length(command.idempotency_key) NOT BETWEEN 16 AND 255
    OR command.collection_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR command.transfer_reference !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR command.collection_reference = command.transfer_reference OR command.destination_wallet_id = '' OR command.destination_customer_id = '' THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id = command.treasury_binding_id
    AND integration_id = command.integration_id AND merchant_id = command.merchant_id AND enabled FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login <> session_user OR binding.verified_at < clock_timestamp() - interval '15 minutes' OR binding.verified_at > clock_timestamp() + interval '1 minute' OR binding.currency <> command.currency OR binding.source_wallet_id = command.destination_wallet_id THEN
    RAISE EXCEPTION 'prefunded card treasury denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=command.integration_id AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card integration denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM prefunded_card.operations WHERE integration_id = command.integration_id AND idempotency_key = command.idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF to_jsonb(existing) @> jsonb_build_object('id',command.id,'integration_id',command.integration_id,'merchant_id',command.merchant_id,'customer_id',command.customer_id,'goal_id',command.goal_id,'treasury_binding_id',command.treasury_binding_id,'request_fingerprint',command.request_fingerprint,'idempotency_key',command.idempotency_key,'saved_method_id',command.saved_method_id,'amount_kobo',command.amount_kobo,'fee_allowance_kobo',command.fee_allowance_kobo,'currency',command.currency,'collection_reference',command.collection_reference,'transfer_reference',command.transfer_reference,'destination_wallet_id',command.destination_wallet_id,'destination_customer_id',command.destination_customer_id) THEN
      RETURN jsonb_build_object('operationId',existing.id,'outcome','reserved','collectionStatus',existing.collection_status,'transferStatus',existing.transfer_status);
    END IF;
    RAISE EXCEPTION 'prefunded card idempotency conflict' USING ERRCODE = '23505';
  END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE goal_id = command.goal_id AND integration_id = command.integration_id
    AND merchant_id = command.merchant_id AND customer_id = command.customer_id AND enabled AND authorized_login=session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card scope denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO mapped FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id = command.integration_id AND goal_id = command.goal_id
    AND merchant_id = command.merchant_id AND customer_id = command.customer_id AND provider_wallet_id = command.destination_wallet_id
    AND provider_customer_id = command.destination_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card destination mismatch' USING ERRCODE = '23514'; END IF;
  PERFORM pm.id FROM public.customer_saved_payment_methods pm WHERE pm.id=command.saved_method_id AND pm.merchant_id=command.merchant_id AND pm.customer_id=command.customer_id AND pm.provider='paystack' AND pm.reusable AND pm.is_active AND pm.disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card saved method denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id = command.goal_id AND merchant_id = command.merchant_id
    AND customer_id = command.customer_id AND status = 'active' AND completed_at IS NULL AND cancelled_at IS NULL AND spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded card goal denied' USING ERRCODE = '23514'; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO active_goal_kobo FROM prefunded_card.operations WHERE goal_id = command.goal_id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  available_goal_kobo := ((goal.target_amount - goal.current_amount) * 100)::bigint - active_goal_kobo;
  available_float_kobo := binding.verified_available_kobo - binding.reserved_kobo - binding.consumed_kobo;
  IF available_goal_kobo < command.amount_kobo THEN RAISE EXCEPTION 'prefunded card goal capacity insufficient' USING ERRCODE = '23514'; END IF;
  IF available_float_kobo < command.amount_kobo THEN RAISE EXCEPTION 'prefunded card float insufficient' USING ERRCODE = '23514'; END IF;
  INSERT INTO prefunded_card.operations (id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,
    request_fingerprint,idempotency_key,saved_method_id,amount_kobo,fee_allowance_kobo,currency,collection_reference,
    transfer_reference,destination_wallet_id,destination_customer_id)
    VALUES (command.id,command.integration_id,command.merchant_id,command.customer_id,command.goal_id,command.treasury_binding_id,
      command.request_fingerprint,command.idempotency_key,command.saved_method_id,command.amount_kobo,command.fee_allowance_kobo,
      command.currency,command.collection_reference,command.transfer_reference,command.destination_wallet_id,command.destination_customer_id)
    ;
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo = reserved_kobo + command.amount_kobo WHERE id = binding.id;
  RETURN jsonb_build_object('operationId',command.id,'outcome','reserved','collectionStatus','not_started','transferStatus','not_started');
END $$;


REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prefunded_card FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON SCHEMA prefunded_card IS 'Staging-only durable reservation and dispatch fencing. It never posts the canonical savings ledger or projects a contribution.';

-- source: storage-functions.sql

CREATE FUNCTION prefunded_card.valid_terminal_evidence(evidence jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF evidence IS NULL OR jsonb_typeof(evidence)<>'object' OR jsonb_typeof(evidence->'amountKobo') IS DISTINCT FROM 'number'
    OR (evidence->>'amountKobo') !~ '^[1-9][0-9]{0,15}$' THEN RETURN false; END IF;
  RETURN (evidence->>'amountKobo')::numeric <= 9007199254740991;
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.lock_scoped_operation(p_operation uuid, p_dispatch boolean DEFAULT false)
RETURNS prefunded_card.operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'prefunded operation isolation denied' USING ERRCODE='42501';
  END IF;
  SELECT treasury_binding_id INTO operation.treasury_binding_id FROM prefunded_card.operations WHERE id=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded operation unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login<>session_user THEN
    RAISE EXCEPTION 'prefunded operation denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO operation FROM prefunded_card.operations WHERE id=p_operation FOR UPDATE;
  IF NOT FOUND OR operation.integration_id<>binding.integration_id OR operation.merchant_id<>binding.merchant_id THEN
    RAISE EXCEPTION 'prefunded operation scope stale' USING ERRCODE='42501';
  END IF;
  IF NOT p_dispatch THEN RETURN operation; END IF;
  IF NOT binding.enabled OR binding.verified_at<clock_timestamp()-interval '15 minutes'
    OR binding.verified_at>clock_timestamp()+interval '1 minute' THEN
    RAISE EXCEPTION 'prefunded operation treasury stale' USING ERRCODE='42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded registry stale' USING ERRCODE='42501'; END IF;
  PERFORM ledger.goal_id FROM piggyvest_savings_ledger.bindings ledger WHERE ledger.integration_id=operation.integration_id
    AND ledger.merchant_id=operation.merchant_id AND ledger.customer_id=operation.customer_id AND ledger.goal_id=operation.goal_id
    AND ledger.enabled AND ledger.authorized_login=session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded ledger binding stale' USING ERRCODE='42501'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping WHERE mapping.integration_id=operation.integration_id
    AND mapping.merchant_id=operation.merchant_id AND mapping.customer_id=operation.customer_id AND mapping.goal_id=operation.goal_id
    AND mapping.provider_wallet_id=operation.destination_wallet_id AND mapping.provider_customer_id=operation.destination_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded mapping stale' USING ERRCODE='42501'; END IF;
  PERFORM customer.id FROM public.customers customer WHERE customer.id=operation.customer_id
    AND customer.merchant_id=operation.merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer stale' USING ERRCODE='42501'; END IF;
  PERFORM method.id FROM public.customer_saved_payment_methods method WHERE method.id=operation.saved_method_id
    AND method.merchant_id=operation.merchant_id AND method.customer_id=operation.customer_id AND method.provider='paystack'
    AND method.reusable AND method.is_active AND method.disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded saved method stale' USING ERRCODE='42501'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id=operation.goal_id AND goal.merchant_id=operation.merchant_id
    AND goal.customer_id=operation.customer_id AND goal.status='active' AND goal.completed_at IS NULL
    AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded goal stale' USING ERRCODE='42501'; END IF;
  RETURN operation;
END $$;

CREATE FUNCTION prefunded_card.request_for_operation(operation prefunded_card.operations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('operationId',operation.id,'integrationId',operation.integration_id,
    'merchantId',operation.merchant_id,'customerId',operation.customer_id,'goalId',operation.goal_id,
    'treasuryBindingId',binding.id,'businessId',binding.expected_business_id,'sourceWalletId',binding.source_wallet_id,
    'collectionReference',operation.collection_reference,'transferReference',operation.transfer_reference,
    'amountKobo',operation.amount_kobo,'currency',operation.currency,'savedMethodId',operation.saved_method_id,
    'destinationWalletId',operation.destination_wallet_id,'destinationCustomerId',operation.destination_customer_id)
  FROM prefunded_card.treasury_bindings binding WHERE binding.id=operation.treasury_binding_id
    AND binding.authorized_login=session_user AND binding.integration_id=operation.integration_id
    AND binding.merchant_id=operation.merchant_id;
$$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_collection(p_operation uuid,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF p_fence IS NULL OR operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN RETURN jsonb_build_object('outcome','stale_or_reconciliation_required'); END IF;
  UPDATE prefunded_card.operations SET collection_status='dispatching',collection_fence=collection_fence+1,collection_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_transfer(p_operation uuid,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF p_fence IS NULL OR operation.collection_status<>'verified_success' OR operation.transfer_status<>'not_started' OR operation.transfer_fence IS DISTINCT FROM p_fence THEN RETURN jsonb_build_object('outcome','stale_or_reconciliation_required'); END IF;
  UPDATE prefunded_card.operations SET transfer_status='dispatching',transfer_fence=transfer_fence+1,transfer_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_reconciliation(p_operation uuid,p_lease_seconds integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid verification lease' USING ERRCODE='22023'; END IF;
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  IF operation.collection_status NOT IN ('dispatching','pending','unknown') AND operation.transfer_status NOT IN ('dispatching','pending','unknown') THEN RETURN jsonb_build_object('outcome','not_verifiable'); END IF;
  IF operation.verification_lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('outcome','leased'); END IF;
  UPDATE prefunded_card.operations SET verification_fence=verification_fence+1,verification_token=token,verification_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','verify_only','operationId',p_operation,'token',token,'fence',operation.verification_fence+1,
    'leg',CASE WHEN operation.collection_status IN ('dispatching','pending','unknown') THEN 'collection' ELSE 'transfer' END,
    'request',prefunded_card.request_for_operation(operation));
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.complete_reconciliation(p_operation uuid,p_token uuid,p_fence bigint,p_leg text,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF p_token IS NULL OR p_fence IS NULL OR operation.verification_token IS DISTINCT FROM p_token OR operation.verification_fence IS DISTINCT FROM p_fence OR operation.verification_lease_expires_at IS NULL OR operation.verification_lease_expires_at<=clock_timestamp() THEN RETURN 'stale'; END IF;
  IF p_leg IS NULL OR p_leg NOT IN ('collection','transfer') OR p_outcome IS NULL OR p_outcome NOT IN ('verified_success','verified_failed') THEN RETURN 'reconciliation_required'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_leg='collection' AND operation.collection_status IN ('dispatching','pending','unknown') AND p_evidence->>'reference'=operation.collection_reference AND p_evidence->>'currency'=operation.currency AND (p_evidence->>'amountKobo')::bigint=operation.amount_kobo AND p_evidence->>'savedMethodId'=operation.saved_method_id::text AND nullif(p_evidence->>'providerTransactionId','') IS NOT NULL THEN
    UPDATE prefunded_card.operations SET collection_status=CASE WHEN p_outcome='verified_success' THEN 'verified_success' WHEN p_outcome='verified_failed' THEN 'verified_failed' ELSE 'unknown' END,collection_provider_transaction_id=p_evidence->>'providerTransactionId',verification_token=NULL,verification_lease_expires_at=NULL WHERE id=p_operation;
    IF p_outcome='verified_failed' THEN UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo WHERE id=operation.treasury_binding_id; END IF;
    RETURN p_outcome;
  END IF;
  IF p_leg='transfer' AND operation.transfer_status IN ('dispatching','pending','unknown') AND p_outcome='verified_success' AND p_evidence->>'reference'=operation.transfer_reference AND p_evidence->>'businessId'=binding.expected_business_id AND p_evidence->>'sourceWalletId'=binding.source_wallet_id AND p_evidence->>'destinationWalletId'=operation.destination_wallet_id AND p_evidence->>'destinationCustomerId'=operation.destination_customer_id AND p_evidence->>'currency'=operation.currency AND (p_evidence->>'amountKobo')::bigint=operation.amount_kobo AND nullif(p_evidence->>'providerTransactionId','') IS NOT NULL THEN
    UPDATE prefunded_card.operations SET transfer_status='verified_success',transfer_provider_transaction_id=p_evidence->>'providerTransactionId',verification_token=NULL,verification_lease_expires_at=NULL WHERE id=p_operation;
    UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo,consumed_kobo=consumed_kobo+operation.amount_kobo WHERE id=operation.treasury_binding_id;
    RETURN 'verified_success';
  END IF;
  UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=p_operation;
  RETURN 'reconciliation_required';
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.record_collection(p_operation uuid,p_fence bigint,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  IF p_fence IS NULL OR operation.collection_status<>'dispatching' OR operation.collection_fence IS DISTINCT FROM p_fence THEN RETURN 'stale'; END IF;
  IF p_outcome='unknown' THEN UPDATE prefunded_card.operations SET collection_status='unknown' WHERE id=p_operation; RETURN 'unknown'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET collection_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('verified_success','verified_failed') OR p_evidence IS NULL OR p_evidence->>'reference' IS DISTINCT FROM operation.collection_reference OR p_evidence->>'currency' IS DISTINCT FROM operation.currency OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo OR p_evidence->>'savedMethodId' IS DISTINCT FROM operation.saved_method_id::text OR nullif(p_evidence->>'providerTransactionId','') IS NULL THEN UPDATE prefunded_card.operations SET collection_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation; RETURN 'reconciliation_required'; END IF;
  UPDATE prefunded_card.operations SET collection_status=CASE WHEN p_outcome='verified_success' THEN 'verified_success' ELSE 'verified_failed' END,collection_provider_transaction_id=p_evidence->>'providerTransactionId' WHERE id=p_operation;
  IF p_outcome='verified_failed' THEN UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo WHERE id=operation.treasury_binding_id; END IF;
  RETURN p_outcome;
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.record_transfer(p_operation uuid,p_fence bigint,p_outcome text,p_evidence jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation); SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF p_fence IS NULL OR operation.transfer_status<>'dispatching' OR operation.transfer_fence IS DISTINCT FROM p_fence THEN RETURN 'stale'; END IF;
  IF p_outcome='unknown' THEN UPDATE prefunded_card.operations SET transfer_status='unknown' WHERE id=p_operation; RETURN 'unknown'; END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN
    UPDATE prefunded_card.operations SET transfer_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation;
    RETURN 'reconciliation_required';
  END IF;
  IF p_outcome IS NULL OR p_outcome<>'verified_success' OR p_evidence IS NULL OR p_evidence->>'reference' IS DISTINCT FROM operation.transfer_reference OR p_evidence->>'businessId' IS DISTINCT FROM binding.expected_business_id OR p_evidence->>'sourceWalletId' IS DISTINCT FROM binding.source_wallet_id OR p_evidence->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id OR p_evidence->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id OR p_evidence->>'currency' IS DISTINCT FROM operation.currency OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo OR nullif(p_evidence->>'providerTransactionId','') IS NULL THEN UPDATE prefunded_card.operations SET transfer_status='unknown',projection_status='reconciliation_required' WHERE id=p_operation; RETURN 'reconciliation_required'; END IF;
  UPDATE prefunded_card.operations SET transfer_status='verified_success',transfer_provider_transaction_id=p_evidence->>'providerTransactionId' WHERE id=p_operation;
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-operation.amount_kobo,consumed_kobo=consumed_kobo+operation.amount_kobo WHERE id=operation.treasury_binding_id;
  RETURN 'verified_success';
END $$;

REVOKE ALL ON FUNCTION prefunded_card.lock_scoped_operation(uuid,boolean),prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prefunded_card FROM PUBLIC,anon,authenticated,service_role;

-- source: treasury-storage.sql

CREATE TABLE prefunded_card.treasury_identities (
  treasury_binding_id uuid PRIMARY KEY REFERENCES prefunded_card.treasury_bindings(id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  expected_business_id text COLLATE "C" NOT NULL,
  source_wallet_id text COLLATE "C" NOT NULL,
  authorized_login name NOT NULL,
  opening_available_kobo bigint NOT NULL CHECK (opening_available_kobo BETWEEN 1 AND 9007199254740991),
  provisioned_by name NOT NULL,
  provisioned_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (pg_catalog.octet_length(expected_business_id) BETWEEN 1 AND 512),
  CHECK (pg_catalog.octet_length(source_wallet_id) BETWEEN 1 AND 512)
);

CREATE TABLE prefunded_card.treasury_snapshots (
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_identities(treasury_binding_id),
  evidence_id text COLLATE "C" NOT NULL,
  sequence_number bigint NOT NULL CHECK (sequence_number BETWEEN 1 AND 9007199254740991),
  observed_at timestamptz NOT NULL,
  available_kobo bigint NOT NULL CHECK (available_kobo BETWEEN 0 AND 9007199254740991),
  verified_by name NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (treasury_binding_id, evidence_id),
  UNIQUE (treasury_binding_id, sequence_number),
  CHECK (pg_catalog.octet_length(evidence_id) BETWEEN 1 AND 128)
);

CREATE TABLE prefunded_card.treasury_replenishments (
  id uuid PRIMARY KEY,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_identities(treasury_binding_id),
  snapshot_evidence_id text COLLATE "C" NOT NULL,
  reconciliation_reference text COLLATE "C" NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  approved_by name NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (treasury_binding_id, snapshot_evidence_id),
  UNIQUE (treasury_binding_id, reconciliation_reference),
  FOREIGN KEY (treasury_binding_id, snapshot_evidence_id)
    REFERENCES prefunded_card.treasury_snapshots(treasury_binding_id, evidence_id),
  CHECK (pg_catalog.octet_length(reconciliation_reference) BETWEEN 1 AND 128)
);

ALTER TABLE prefunded_card.treasury_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.treasury_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.treasury_replenishments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.treasury_identities, prefunded_card.treasury_snapshots,
  prefunded_card.treasury_replenishments FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_treasury_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'prefunded treasury identity immutable' USING ERRCODE = '42501';
END $$;

CREATE FUNCTION prefunded_card.guard_treasury_binding_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'prefunded treasury binding identity immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.enabled IS DISTINCT FROM NEW.enabled THEN
    IF OLD.enabled AND NOT NEW.enabled
      AND (to_jsonb(NEW) - ARRAY['enabled']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['enabled']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'prefunded treasury binding reenable denied' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['verified_available_kobo', 'reserved_kobo', 'consumed_kobo', 'verified_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['verified_available_kobo', 'reserved_kobo', 'consumed_kobo', 'verified_at']) THEN
    RAISE EXCEPTION 'prefunded treasury binding identity immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_treasury_identity_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_identities
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_identity_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_identities
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_snapshot_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_snapshots
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_replenishment_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_replenishments
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_binding_identity_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.treasury_bindings
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_binding_identity();
CREATE TRIGGER prefunded_treasury_snapshot_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_replenishment_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_replenishments
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_identity();
CREATE TRIGGER prefunded_treasury_binding_no_truncate
  BEFORE TRUNCATE ON prefunded_card.treasury_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_treasury_binding_identity();

REVOKE ALL ON FUNCTION prefunded_card.guard_treasury_identity(),
  prefunded_card.guard_treasury_binding_identity() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE prefunded_card.treasury_identities IS
  'Staging-only immutable owner-provisioned business/source/worker identity. It is not inferred from a customer or a provider balance.';
COMMENT ON TABLE prefunded_card.treasury_snapshots IS
  'Verifier-only immutable observations. A snapshot may block spending but never increases company float.';
COMMENT ON TABLE prefunded_card.treasury_replenishments IS
  'Explicit independently verified and deduplicated float replenishments. Every row reconciles exactly one observed snapshot delta.';

-- source: treasury-functions.sql

CREATE FUNCTION prefunded_card.require_treasury_role(required_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE role_id oid;
BEGIN
  role_id := to_regrole(required_role);
  IF role_id IS NULL OR NOT pg_has_role(session_user, role_id, 'member') THEN
    RAISE EXCEPTION 'prefunded treasury role denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.provision_treasury_identity(
  binding_id uuid, integration_id uuid, merchant_id uuid, expected_business_id text,
  source_wallet_id text, authorized_login name, opening_available_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  IF binding_id IS NULL OR integration_id IS NULL OR merchant_id IS NULL
    OR expected_business_id IS NULL OR source_wallet_id IS NULL OR authorized_login IS NULL
    OR opening_available_kobo IS NULL OR opening_available_kobo NOT BETWEEN 1 AND 9007199254740991
    OR octet_length(expected_business_id) NOT BETWEEN 1 AND 512
    OR octet_length(source_wallet_id) NOT BETWEEN 1 AND 512
    OR to_regrole(authorized_login::text) IS NULL
    OR NOT pg_has_role(authorized_login, 'prefunded_treasury_ledger_worker', 'member') THEN
    RAISE EXCEPTION 'invalid prefunded treasury identity' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities
    WHERE treasury_binding_id = binding_id FOR UPDATE;
  IF FOUND THEN
    IF identity.integration_id = provision_treasury_identity.integration_id
      AND identity.merchant_id = provision_treasury_identity.merchant_id
      AND identity.expected_business_id = provision_treasury_identity.expected_business_id
      AND identity.source_wallet_id = provision_treasury_identity.source_wallet_id
      AND identity.authorized_login = provision_treasury_identity.authorized_login
      AND identity.opening_available_kobo = provision_treasury_identity.opening_available_kobo THEN
      RETURN 'duplicate';
    END IF;
    RAISE EXCEPTION 'conflicting prefunded treasury identity' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = provision_treasury_identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = provision_treasury_identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_bindings (
    id, integration_id, merchant_id, expected_business_id, source_wallet_id, currency,
    verified_available_kobo, reserved_kobo, consumed_kobo, verified_at, authorized_login, enabled
  ) VALUES (
    binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id, 'NGN',
    opening_available_kobo, 0, 0, clock_timestamp(), authorized_login, true
  );
  INSERT INTO prefunded_card.treasury_identities (
    treasury_binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id,
    authorized_login, opening_available_kobo, provisioned_by
  ) VALUES (
    binding_id, integration_id, merchant_id, expected_business_id, source_wallet_id,
    authorized_login, opening_available_kobo, session_user
  );
  RETURN 'provisioned';
END $$;

CREATE FUNCTION prefunded_card.record_treasury_snapshot(
  binding_id uuid, evidence_id text, sequence_number bigint, observed_at timestamptz,
  available_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE existing prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE latest prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_verifier');
  IF binding_id IS NULL OR evidence_id IS NULL OR sequence_number IS NULL OR observed_at IS NULL
    OR available_kobo IS NULL OR sequence_number NOT BETWEEN 1 AND 9007199254740991
    OR available_kobo NOT BETWEEN 0 AND 9007199254740991
    OR octet_length(evidence_id) NOT BETWEEN 1 AND 128
    OR observed_at NOT BETWEEN clock_timestamp() - interval '15 minutes'
      AND clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'invalid prefunded treasury snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury binding denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN
    RAISE EXCEPTION 'prefunded treasury identity denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO existing FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
      AND stored.evidence_id = record_treasury_snapshot.evidence_id FOR UPDATE;
  IF FOUND THEN
    IF existing.sequence_number = record_treasury_snapshot.sequence_number
      AND existing.observed_at = record_treasury_snapshot.observed_at
      AND existing.available_kobo = record_treasury_snapshot.available_kobo THEN RETURN 'duplicate'; END IF;
    RAISE EXCEPTION 'conflicting prefunded treasury snapshot' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO latest FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
    ORDER BY stored.sequence_number DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (sequence_number <= latest.sequence_number OR observed_at <= latest.observed_at) THEN
    RAISE EXCEPTION 'non-monotonic prefunded treasury snapshot' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_snapshots (
    treasury_binding_id, evidence_id, sequence_number, observed_at, available_kobo, verified_by
  ) VALUES (binding_id, evidence_id, sequence_number, observed_at, available_kobo, session_user);
  UPDATE prefunded_card.treasury_bindings SET verified_at = observed_at WHERE id = binding_id;
  RETURN 'recorded';
END $$;

CREATE FUNCTION prefunded_card.treasury_reservation_ready(binding_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE snapshot prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE replenished_kobo bigint;
DECLARE expected_available_kobo bigint;
BEGIN
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN RETURN false; END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO snapshot FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
    ORDER BY stored.sequence_number DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR snapshot.observed_at < clock_timestamp() - interval '15 minutes'
    OR snapshot.observed_at > clock_timestamp() + interval '1 minute' THEN RETURN false; END IF;
  SELECT coalesce(sum(replenishment.amount_kobo), 0) INTO replenished_kobo
    FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id;
  expected_available_kobo := identity.opening_available_kobo + replenished_kobo - binding.consumed_kobo;
  RETURN expected_available_kobo >= 0 AND binding.verified_available_kobo = identity.opening_available_kobo + replenished_kobo
    AND binding.reserved_kobo + binding.consumed_kobo <= binding.verified_available_kobo
    AND snapshot.available_kobo = expected_available_kobo;
END $$;

CREATE FUNCTION prefunded_card.approve_treasury_replenishment(
  replenishment_id uuid, binding_id uuid, snapshot_evidence_id text,
  reconciliation_reference text, amount_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE snapshot prefunded_card.treasury_snapshots%ROWTYPE;
DECLARE replenished_kobo bigint;
DECLARE expected_before_kobo bigint;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  IF replenishment_id IS NULL OR binding_id IS NULL OR snapshot_evidence_id IS NULL
    OR reconciliation_reference IS NULL OR amount_kobo IS NULL
    OR amount_kobo NOT BETWEEN 1 AND 9007199254740991
    OR octet_length(snapshot_evidence_id) NOT BETWEEN 1 AND 128
    OR octet_length(reconciliation_reference) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid prefunded treasury replenishment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  SELECT * INTO snapshot FROM prefunded_card.treasury_snapshots AS stored
    WHERE stored.treasury_binding_id = binding_id
      AND stored.evidence_id = approve_treasury_replenishment.snapshot_evidence_id FOR SHARE;
  IF NOT FOUND OR identity.treasury_binding_id IS NULL OR snapshot.verified_by = session_user
    OR snapshot.observed_at NOT BETWEEN clock_timestamp() - interval '15 minutes'
      AND clock_timestamp() + interval '1 minute'
    OR NOT binding.enabled OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login
    OR binding.currency <> 'NGN' THEN
    RAISE EXCEPTION 'prefunded treasury replenishment denied' USING ERRCODE = '42501';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = identity.integration_id AND registry.enabled
      AND registry.expected_provider_account_id = identity.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded treasury registry denied' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id
      AND replenishment.snapshot_evidence_id = approve_treasury_replenishment.snapshot_evidence_id) THEN
    RAISE EXCEPTION 'prefunded treasury snapshot already reconciled' USING ERRCODE = '42501';
  END IF;
  IF snapshot.sequence_number <> (
    SELECT max(stored.sequence_number) FROM prefunded_card.treasury_snapshots AS stored
      WHERE stored.treasury_binding_id = binding_id
  ) THEN
    RAISE EXCEPTION 'prefunded treasury snapshot stale' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(replenishment.amount_kobo), 0) INTO replenished_kobo
    FROM prefunded_card.treasury_replenishments AS replenishment
    WHERE replenishment.treasury_binding_id = binding_id;
  expected_before_kobo := identity.opening_available_kobo + replenished_kobo - binding.consumed_kobo;
  IF expected_before_kobo < 0 OR snapshot.available_kobo <> expected_before_kobo + amount_kobo THEN
    RAISE EXCEPTION 'prefunded treasury reconciliation mismatch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO prefunded_card.treasury_replenishments (
    id, treasury_binding_id, snapshot_evidence_id, reconciliation_reference, amount_kobo, approved_by
  ) VALUES (replenishment_id, binding_id, snapshot_evidence_id, reconciliation_reference, amount_kobo, session_user);
  UPDATE prefunded_card.treasury_bindings SET verified_available_kobo = verified_available_kobo + amount_kobo
    WHERE id = binding_id;
  RETURN 'replenished';
END $$;

ALTER FUNCTION prefunded_card.reserve(jsonb) RENAME TO reserve_pre_treasury_guard;
CREATE FUNCTION prefunded_card.reserve(command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding_text text;
BEGIN
  IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
    RAISE EXCEPTION 'invalid prefunded card command' USING ERRCODE = '22023';
  END IF;
  binding_text := command->>'treasuryBindingId';
  IF binding_text IS NULL OR binding_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NOT prefunded_card.treasury_reservation_ready(binding_text::uuid) THEN
    RAISE EXCEPTION 'prefunded treasury refresh required' USING ERRCODE = '42501';
  END IF;
  RETURN prefunded_card.reserve_pre_treasury_guard(command);
END $$;

CREATE FUNCTION prefunded_card.suspend_treasury_binding(binding_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE identity prefunded_card.treasury_identities%ROWTYPE;
BEGIN
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_provisioner');
  SELECT * INTO binding FROM prefunded_card.treasury_bindings AS stored
    WHERE stored.id = binding_id FOR UPDATE;
  SELECT * INTO identity FROM prefunded_card.treasury_identities AS stored
    WHERE stored.treasury_binding_id = binding_id FOR SHARE;
  IF NOT FOUND OR identity.treasury_binding_id IS NULL OR binding.integration_id <> identity.integration_id
    OR binding.merchant_id <> identity.merchant_id OR binding.expected_business_id <> identity.expected_business_id
    OR binding.source_wallet_id <> identity.source_wallet_id OR binding.authorized_login <> identity.authorized_login THEN
    RAISE EXCEPTION 'prefunded treasury suspend denied' USING ERRCODE = '42501';
  END IF;
  IF NOT binding.enabled THEN RETURN 'already_suspended'; END IF;
  UPDATE prefunded_card.treasury_bindings SET enabled = false WHERE id = binding_id;
  RETURN 'suspended';
END $$;

CREATE FUNCTION prefunded_card.guard_treasury_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE projection_ready boolean;
BEGIN
  IF (OLD.collection_status = 'not_started' AND NEW.collection_status = 'dispatching')
    OR (OLD.transfer_status = 'not_started' AND NEW.transfer_status = 'dispatching') THEN
    IF NOT prefunded_card.treasury_reservation_ready(OLD.treasury_binding_id)
      OR to_regprocedure('prefunded_card.credit_route_dispatch_ready(uuid)') IS NULL THEN
      RAISE EXCEPTION 'prefunded treasury dispatch denied' USING ERRCODE = '42501';
    END IF;
    EXECUTE 'SELECT prefunded_card.credit_route_dispatch_ready($1)'
      INTO projection_ready USING OLD.id;
    IF projection_ready IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'prefunded treasury projection denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_treasury_dispatch_guard
  BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_treasury_dispatch();

REVOKE ALL ON FUNCTION prefunded_card.require_treasury_role(text),
  prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint),
  prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint),
  prefunded_card.treasury_reservation_ready(uuid),
  prefunded_card.approve_treasury_replenishment(uuid,uuid,text,text,bigint),
  prefunded_card.reserve_pre_treasury_guard(jsonb), prefunded_card.reserve(jsonb),
  prefunded_card.suspend_treasury_binding(uuid), prefunded_card.guard_treasury_dispatch()
  FROM PUBLIC, anon, authenticated, service_role;

-- source: projection-storage.sql
CREATE TABLE prefunded_card.credit_routes (
  goal_id uuid PRIMARY KEY,
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE TABLE prefunded_card.projections (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  contribution_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_contributions(id) DEFERRABLE INITIALLY DEFERRED,
  ledger_operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (operation_id=ledger_operation_id)
);
CREATE TABLE prefunded_card.provider_aliases (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL CHECK (length(provider_transaction_id) BETWEEN 1 AND 512),
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (integration_id,provider_transaction_id)
);
CREATE INDEX prefunded_card_credit_routes_customer_idx ON prefunded_card.credit_routes(customer_id);
CREATE INDEX prefunded_card_credit_routes_merchant_idx ON prefunded_card.credit_routes(merchant_id);
CREATE INDEX prefunded_card_credit_routes_integration_idx ON prefunded_card.credit_routes(integration_id);
CREATE INDEX prefunded_card_aliases_operation_idx ON prefunded_card.provider_aliases(operation_id);
ALTER TABLE prefunded_card.credit_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.provider_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.credit_routes,prefunded_card.projections,prefunded_card.provider_aliases FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_projection_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded projection evidence immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER prefunded_credit_route_immutable BEFORE UPDATE OR DELETE ON prefunded_card.credit_routes
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_credit_route_no_truncate BEFORE TRUNCATE ON prefunded_card.credit_routes
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_projection_immutable BEFORE UPDATE OR DELETE ON prefunded_card.projections
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_projection_no_truncate BEFORE TRUNCATE ON prefunded_card.projections
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_alias_immutable BEFORE UPDATE OR DELETE ON prefunded_card.provider_aliases
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_alias_no_truncate BEFORE TRUNCATE ON prefunded_card.provider_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();

CREATE FUNCTION prefunded_card.require_credit_route(operation prefunded_card.operations,p_system text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_system IS NULL OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM p_system THEN
    RAISE EXCEPTION 'prefunded projection database refused' USING ERRCODE='42501';
  END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE goal_id=operation.goal_id
    AND integration_id=operation.integration_id AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id
    AND authorized_login=session_user AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection binding refused' USING ERRCODE='42501'; END IF;
  PERFORM goal_id FROM prefunded_card.credit_routes WHERE goal_id=operation.goal_id AND integration_id=operation.integration_id
    AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id AND system_identifier=p_system FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection route refused' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION prefunded_card.guard_contribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_goal uuid; valid boolean;
BEGIN
  selected_goal:=CASE WHEN TG_OP='DELETE' THEN OLD.goal_id ELSE NEW.goal_id END;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=selected_goal)
    AND (TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=OLD.goal_id)) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT true INTO valid FROM prefunded_card.projections projection
      JOIN prefunded_card.operations operation ON operation.id=projection.operation_id
      WHERE projection.contribution_id=NEW.id AND projection.created_xid=pg_current_xact_id()
        AND operation.goal_id=NEW.goal_id AND operation.merchant_id=NEW.merchant_id AND operation.customer_id=NEW.customer_id
        AND projection.amount_kobo::numeric/100=NEW.amount AND NEW.status='completed'
        AND NEW.source_type='paystack_authorization' AND NEW.idempotency_key='pvb-card:'||operation.id;
    IF valid IS TRUE THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enrolled savings requires canonical contribution projection' USING ERRCODE='42501';
END $$;
CREATE TRIGGER prefunded_card_canonical_contribution BEFORE INSERT OR UPDATE OR DELETE ON public.customer_savings_contributions
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_contribution();
REVOKE ALL ON FUNCTION prefunded_card.reject_projection_mutation(),prefunded_card.require_credit_route(prefunded_card.operations,text),
  prefunded_card.guard_contribution() FROM PUBLIC,anon,authenticated,service_role;

-- source: projection-functions.sql
CREATE FUNCTION prefunded_card.read_operation(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  RETURN jsonb_build_object('operationId',operation.id,'collectionStatus',operation.collection_status,
    'transferStatus',operation.transfer_status,'projectionStatus',operation.projection_status,
    'collectionFence',operation.collection_fence,'transferFence',operation.transfer_fence);
END $$;

CREATE FUNCTION prefunded_card.link_inflow(p_operation uuid,p_system text,p_evidence jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE; existing uuid;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF operation.collection_status<>'verified_success' OR operation.transfer_status<>'verified_success'
    OR NOT prefunded_card.valid_terminal_evidence(p_evidence) THEN RETURN 'deferred'; END IF;
  IF p_evidence->>'reference' IS DISTINCT FROM operation.transfer_reference
    OR p_evidence->>'currency' IS DISTINCT FROM operation.currency
    OR (p_evidence->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo
    OR p_evidence->>'businessId' IS DISTINCT FROM binding.expected_business_id
    OR p_evidence->>'sourceWalletId' IS DISTINCT FROM binding.source_wallet_id
    OR p_evidence->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id
    OR p_evidence->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id
    OR nullif(p_evidence->>'providerTransactionId','') IS NULL
    OR length(p_evidence->>'providerTransactionId')>512 THEN RETURN 'conflict'; END IF;
  INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
    VALUES(operation.integration_id,p_evidence->>'providerTransactionId',operation.id) ON CONFLICT DO NOTHING;
  SELECT operation_id INTO existing FROM prefunded_card.provider_aliases
    WHERE integration_id=operation.integration_id AND provider_transaction_id=p_evidence->>'providerTransactionId';
  IF existing IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'prefunded alias conflict' USING ERRCODE='23505'; END IF;
  RETURN 'linked';
END $$;

CREATE FUNCTION prefunded_card.project(p_operation uuid,p_system text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; recorded jsonb; contribution uuid:=gen_random_uuid();
DECLARE next_amount numeric; alias_operation uuid; canonical_principal numeric;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  IF operation.projection_status='reconciliation_required' THEN RETURN 'deferred'; END IF;
  IF operation.collection_status<>'verified_success' OR operation.transfer_status<>'verified_success'
    OR nullif(operation.collection_provider_transaction_id,'') IS NULL
    OR nullif(operation.transfer_provider_transaction_id,'') IS NULL THEN RETURN 'deferred'; END IF;
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=operation.integration_id AND mapping.merchant_id=operation.merchant_id
      AND mapping.customer_id=operation.customer_id AND mapping.goal_id=operation.goal_id
      AND mapping.provider_wallet_id=operation.destination_wallet_id
      AND mapping.provider_customer_id=operation.destination_customer_id FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection ownership refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=operation.integration_id AND enabled
    AND expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection integration refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=operation.goal_id
    AND merchant_id=operation.merchant_id AND customer_id=operation.customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded projection goal refused' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=operation.id) THEN RETURN 'duplicate'; END IF;
  IF goal.status<>'active' OR goal.completed_at IS NOT NULL OR goal.cancelled_at IS NOT NULL OR goal.spent_at IS NOT NULL THEN
    RETURN 'deferred';
  END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO canonical_principal FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id
    WHERE entry.goal_id=operation.goal_id AND entry.integration_id=operation.integration_id AND posting.account='principal';
  IF canonical_principal IS DISTINCT FROM goal.current_amount*100 THEN
    RAISE EXCEPTION 'prefunded projection requires reconciled principal' USING ERRCODE='23514';
  END IF;
  next_amount:=goal.current_amount+operation.amount_kobo::numeric/100;
  IF next_amount>goal.target_amount THEN RETURN 'deferred'; END IF;
  INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
    VALUES(operation.integration_id,operation.transfer_provider_transaction_id,operation.id) ON CONFLICT DO NOTHING;
  SELECT operation_id INTO alias_operation FROM prefunded_card.provider_aliases WHERE integration_id=operation.integration_id
    AND provider_transaction_id=operation.transfer_provider_transaction_id;
  IF alias_operation IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'prefunded projection alias conflict' USING ERRCODE='23505'; END IF;
  recorded:=piggyvest_savings_ledger.apply(operation.integration_id,operation.merchant_id,operation.customer_id,operation.goal_id,
    jsonb_build_object('operationId',operation.id,'kind','credit_principal','principalKobo',operation.amount_kobo,
      'interestKobo',0,'evidenceId','pvb-card:'||operation.id,'referenceId',NULL));
  IF recorded->>'outcome' IS DISTINCT FROM 'recorded' OR recorded->>'operationId' IS DISTINCT FROM operation.id::text THEN
    RAISE EXCEPTION 'prefunded canonical acknowledgement refused';
  END IF;
  INSERT INTO prefunded_card.projections(operation_id,contribution_id,ledger_operation_id,amount_kobo)
    VALUES(operation.id,contribution,operation.id,operation.amount_kobo);
  INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(contribution,operation.goal_id,operation.merchant_id,operation.customer_id,operation.amount_kobo::numeric/100,
      'paystack_authorization','completed',clock_timestamp(),'pvb-card:'||operation.id,
      jsonb_build_object('funding_model','prefunded_piggyvest','operation_id',operation.id,
        'transfer_reference',operation.transfer_reference,'provider_transaction_id',operation.transfer_provider_transaction_id));
  UPDATE public.customer_savings_goals SET current_amount=next_amount,
    status=CASE WHEN next_amount=target_amount THEN 'completed' ELSE 'active' END,
    completed_at=CASE WHEN next_amount=target_amount THEN clock_timestamp() ELSE completed_at END,
    updated_at=clock_timestamp() WHERE id=operation.goal_id;
  UPDATE prefunded_card.operations SET projection_status='applied' WHERE id=operation.id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.project(uuid,text),prefunded_card.link_inflow(uuid,text,jsonb),prefunded_card.read_operation(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: projection-inflow-guard.sql
ALTER FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  SET SCHEMA prefunded_card;
ALTER FUNCTION prefunded_card.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  RENAME TO legacy_inflow;
REVOKE ALL ON FUNCTION prefunded_card.legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

CREATE FUNCTION public.recognize_piggyvest_staging_inflow(
  p_provider_transaction_id text,p_event_data_id text,p_event_id text,p_provider_customer_id text,p_wallet_id text,
  p_amount_kobo bigint,p_fee_kobo bigint,p_reference text,p_session_id text,p_credited_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE enrolled boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM prefunded_card.credit_routes route
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=route.integration_id
      AND mapping.goal_id=route.goal_id AND mapping.merchant_id=route.merchant_id AND mapping.customer_id=route.customer_id
    WHERE mapping.provider_wallet_id=p_wallet_id) INTO enrolled;
  IF NOT enrolled AND to_regclass('prefunded_card.provider_evidence') IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM prefunded_card.provider_evidence receipt
      JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=receipt.integration_id
        AND mapping.provider_wallet_id=receipt.observation->>'destinationWalletId'
      JOIN prefunded_card.credit_routes route ON route.integration_id=mapping.integration_id AND route.goal_id=mapping.goal_id
        AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id
      WHERE receipt.event_id=p_event_id) INTO enrolled;
  END IF;
  IF enrolled THEN
    IF EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias
      JOIN prefunded_card.operations operation ON operation.id=alias.operation_id AND operation.integration_id=alias.integration_id
      JOIN prefunded_card.projections projection ON projection.operation_id=operation.id
      JOIN prefunded_card.credit_routes route ON route.goal_id=operation.goal_id AND route.integration_id=operation.integration_id
      WHERE alias.provider_transaction_id=p_provider_transaction_id AND operation.transfer_reference=p_reference
        AND operation.destination_wallet_id=p_wallet_id AND operation.destination_customer_id=p_provider_customer_id
        AND operation.amount_kobo=p_amount_kobo AND p_fee_kobo=0
        AND route.system_identifier=(SELECT system_identifier::text FROM pg_control_system())) THEN
      RETURN 'duplicate';
    END IF;
    IF to_regprocedure('prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)') IS NOT NULL THEN
      RETURN prefunded_card.apply_verified_legacy_inflow(p_provider_transaction_id,p_event_data_id,p_event_id,
        p_provider_customer_id,p_wallet_id,p_amount_kobo,p_fee_kobo,p_reference,p_session_id,p_credited_at);
    END IF;
    RAISE EXCEPTION 'enrolled wallet inflow requires canonical correlation' USING ERRCODE='55000';
  END IF;
  RETURN prefunded_card.legacy_inflow(p_provider_transaction_id,p_event_data_id,p_event_id,p_provider_customer_id,p_wallet_id,
    p_amount_kobo,p_fee_kobo,p_reference,p_session_id,p_credited_at);
END $$;
REVOKE ALL ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  TO pvb_staging_app_worker;

-- source: projection-admission.sql
CREATE FUNCTION prefunded_card.credit_route_dispatch_ready(p_operation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,(SELECT system_identifier::text FROM pg_control_system()));
  RETURN true;
END $$;
CREATE FUNCTION prefunded_card.guard_credit_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE principal numeric; current_amount numeric;
BEGIN
  IF TG_OP='INSERT' OR (OLD.collection_status='not_started' AND NEW.collection_status='dispatching')
    OR (OLD.transfer_status='not_started' AND NEW.transfer_status='dispatching') THEN
    PERFORM prefunded_card.require_credit_route(NEW,(SELECT system_identifier::text FROM pg_control_system()));
    SELECT goal.current_amount INTO current_amount FROM public.customer_savings_goals goal
      WHERE goal.id=NEW.goal_id AND goal.merchant_id=NEW.merchant_id AND goal.customer_id=NEW.customer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'prefunded admission goal refused' USING ERRCODE='42501'; END IF;
    SELECT coalesce(sum(posting.amount_kobo),0) INTO principal FROM piggyvest_savings_ledger.postings posting
      JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
      WHERE operation.goal_id=NEW.goal_id AND operation.integration_id=NEW.integration_id AND posting.account='principal';
    IF principal IS DISTINCT FROM current_amount*100 THEN
      RAISE EXCEPTION 'prefunded admission requires reconciled principal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_credit_admission BEFORE INSERT OR UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_credit_admission();
REVOKE ALL ON FUNCTION prefunded_card.guard_credit_admission(),prefunded_card.credit_route_dispatch_ready(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: authorization-storage.sql
CREATE TABLE prefunded_card.authorization_bindings (
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  saved_method_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  transaction_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  provider_reference text COLLATE "C" NOT NULL,
  email text COLLATE "C" NOT NULL,
  authorization_code text COLLATE "C" NOT NULL,
  authorization_signature text COLLATE "C" NOT NULL,
  paystack_customer_code text COLLATE "C" NOT NULL,
  domain text COLLATE "C" NOT NULL CHECK (domain='test'),
  reusable boolean NOT NULL CHECK (reusable),
  authorized_login name NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  database_name name NOT NULL,
  provisioned_by name NOT NULL,
  provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (treasury_binding_id,saved_method_id),
  UNIQUE (treasury_binding_id,transaction_id),
  CHECK (length(authorization_code) BETWEEN 6 AND 512 AND authorization_code ~ '^AUTH_[A-Za-z0-9_]+$'),
  CHECK (length(paystack_customer_code) BETWEEN 5 AND 512 AND paystack_customer_code ~ '^CUS_[A-Za-z0-9_]+$'),
  CHECK (length(email) BETWEEN 3 AND 254 AND email !~ '[[:space:][:cntrl:]]'),
  CHECK (length(authorization_signature) BETWEEN 1 AND 512 AND authorization_signature !~ '[[:space:][:cntrl:]]'),
  CHECK (provider_transaction_id ~ '^[1-9][0-9]{0,19}$' AND provider_transaction_id::numeric<=18446744073709551615),
  CHECK (length(provider_reference) BETWEEN 1 AND 128 AND provider_reference ~ '^[A-Za-z0-9.=-]+$')
);
CREATE INDEX authorization_binding_integration_idx ON prefunded_card.authorization_bindings(integration_id);
CREATE INDEX authorization_binding_merchant_idx ON prefunded_card.authorization_bindings(merchant_id);
CREATE INDEX authorization_binding_customer_idx ON prefunded_card.authorization_bindings(customer_id);
ALTER TABLE prefunded_card.authorization_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.authorization_bindings FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION prefunded_card.guard_authorization_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END $$;
CREATE TRIGGER authorization_binding_immutable BEFORE UPDATE OR DELETE ON prefunded_card.authorization_bindings
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_authorization_binding();
CREATE TRIGGER authorization_binding_no_truncate BEFORE TRUNCATE ON prefunded_card.authorization_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_authorization_binding();
REVOKE ALL ON FUNCTION prefunded_card.guard_authorization_binding() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE prefunded_card.authorization_bindings IS
  'Private immutable proof for an existing saved card, populated only after restricted test Paystack verification. Not a public card catalog; survives removal or mutation of the original card for historical verification.';

-- source: authorization-candidate.sql
CREATE FUNCTION prefunded_card.authorization_scope(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_system text,p_provision boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE required_role oid; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  SELECT oid INTO required_role FROM pg_roles WHERE rolname=CASE WHEN p_provision
    THEN 'prefunded_card_authorization_provisioner' ELSE 'prefunded_card_authorization_reader' END;
  IF required_role IS NULL OR NOT pg_has_role(session_user,required_role,'MEMBER')
    OR session_user IN ('anon','authenticated','service_role')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND NOT rolsuper AND NOT rolbypassrls)
    OR p_system IS NULL OR p_system !~ '^[0-9]{1,20}$'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings
    WHERE id=p_treasury AND integration_id=p_integration AND merchant_id=p_merchant FOR SHARE;
  IF NOT FOUND OR (NOT p_provision AND binding.authorized_login<>session_user) THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  IF p_provision THEN
    PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
      AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
    IF NOT FOUND OR NOT binding.enabled THEN
      RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
    END IF;
  END IF;
END $$;

CREATE FUNCTION prefunded_card.authorization_candidate(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_transaction uuid,p_system text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE method public.customer_saved_payment_methods%ROWTYPE; payment public.transactions%ROWTYPE;
DECLARE merchant_slug text; amount_kobo numeric;
BEGIN
  PERFORM prefunded_card.authorization_scope(p_treasury,p_integration,p_merchant,p_system,true);
  PERFORM id FROM public.customers WHERE id=p_customer AND merchant_id=p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END IF;
  SELECT slug INTO merchant_slug FROM public.merchants WHERE id=p_merchant FOR SHARE;
  SELECT * INTO method FROM public.customer_saved_payment_methods WHERE id=p_method
    AND merchant_id=p_merchant AND customer_id=p_customer AND provider='paystack'
    AND is_active AND reusable AND disabled_at IS NULL FOR SHARE;
  IF NOT FOUND OR method.authorization_code !~ '^AUTH_[A-Za-z0-9_]+$'
    OR length(method.authorization_code) NOT BETWEEN 6 AND 512
    OR length(method.authorization_signature) NOT BETWEEN 1 AND 512
    OR method.authorization_signature ~ '[[:space:][:cntrl:]]'
    OR method.authorization_data->>'authorization_code' IS DISTINCT FROM method.authorization_code
    OR method.authorization_data->>'signature' IS DISTINCT FROM method.authorization_signature
    OR method.authorization_data->'reusable' IS DISTINCT FROM 'true'::jsonb
    OR method.authorization_data->>'channel' IS DISTINCT FROM 'card' THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO payment FROM public.transactions WHERE id=p_transaction
    AND merchant_id=p_merchant AND gateway='paystack' AND transaction_type='payment'
    AND status='completed' AND currency='NGN' FOR SHARE;
  IF NOT FOUND OR payment.metadata->>'customer_id' IS DISTINCT FROM p_customer::text
    OR payment.metadata->>'customer_email' IS DISTINCT FROM method.provider_customer_email
    OR payment.metadata->>'merchant_slug' IS DISTINCT FROM merchant_slug
    OR payment.metadata->>'transaction_type' IS DISTINCT FROM 'savings_authorization'
    OR payment.gateway_reference IS NULL OR payment.gateway_reference !~ '^[A-Za-z0-9.=-]+$'
    OR length(payment.gateway_reference) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  amount_kobo:=payment.amount*100;
  IF amount_kobo IS NULL OR amount_kobo NOT BETWEEN 1 AND 9007199254740991 OR trunc(amount_kobo)<>amount_kobo THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('savedMethodId',method.id,'merchantId',method.merchant_id,
    'customerId',method.customer_id,'transactionId',payment.id,'email',method.provider_customer_email,
    'authorizationCode',method.authorization_code,'signature',method.authorization_signature,
    'reference',payment.gateway_reference,'amountKobo',amount_kobo,'merchantSlug',merchant_slug);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.authorization_scope(uuid,uuid,uuid,text,boolean),
  prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- source: authorization-functions.sql
CREATE FUNCTION prefunded_card.provision_authorization(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_transaction uuid,p_system text,p_receipt jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate jsonb; stored prefunded_card.authorization_bindings%ROWTYPE; worker name;
BEGIN
  candidate:=prefunded_card.authorization_candidate(p_treasury,p_integration,p_merchant,p_customer,p_method,p_transaction,p_system);
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object'
    OR p_receipt->>'status' IS DISTINCT FROM 'success' OR p_receipt->>'domain' IS DISTINCT FROM 'test'
    OR p_receipt->>'currency' IS DISTINCT FROM 'NGN' OR p_receipt->>'channel' IS DISTINCT FROM 'card'
    OR p_receipt->>'reference' IS DISTINCT FROM candidate->>'reference'
    OR p_receipt->'amount' IS DISTINCT FROM candidate->'amountKobo'
    OR p_receipt#>>'{customer,email}' IS DISTINCT FROM candidate->>'email'
    OR p_receipt#>>'{authorization,authorization_code}' IS DISTINCT FROM candidate->>'authorizationCode'
    OR p_receipt#>>'{authorization,signature}' IS DISTINCT FROM candidate->>'signature'
    OR p_receipt#>>'{authorization,channel}' IS DISTINCT FROM 'card'
    OR p_receipt#>'{authorization,reusable}' IS DISTINCT FROM 'true'::jsonb
    OR p_receipt#>>'{metadata,customer_id}' IS DISTINCT FROM candidate->>'customerId'
    OR p_receipt#>>'{metadata,merchant_slug}' IS DISTINCT FROM candidate->>'merchantSlug'
    OR p_receipt#>>'{metadata,transaction_type}' IS DISTINCT FROM 'savings_authorization'
    OR coalesce(p_receipt->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR (p_receipt->>'id')::numeric>18446744073709551615
    OR coalesce(p_receipt#>>'{customer,customer_code}','') !~ '^CUS_[A-Za-z0-9_]+$'
    OR length(p_receipt#>>'{customer,customer_code}')>512 THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  SELECT authorized_login INTO worker FROM prefunded_card.treasury_bindings WHERE id=p_treasury FOR SHARE;
  INSERT INTO prefunded_card.authorization_bindings(
    treasury_binding_id,saved_method_id,integration_id,merchant_id,customer_id,transaction_id,
    provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,
    paystack_customer_code,domain,reusable,authorized_login,system_identifier,database_name,provisioned_by
  ) VALUES(p_treasury,p_method,p_integration,p_merchant,p_customer,p_transaction,
    p_receipt->>'id',p_receipt->>'reference',p_receipt#>>'{customer,email}',
    p_receipt#>>'{authorization,authorization_code}',p_receipt#>>'{authorization,signature}',
    p_receipt#>>'{customer,customer_code}',p_receipt->>'domain',true,worker,p_system,current_database(),session_user)
    ON CONFLICT (treasury_binding_id,saved_method_id) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('savedMethodId',p_method,'transactionId',p_transaction,'outcome','provisioned');
  END IF;
  SELECT * INTO stored FROM prefunded_card.authorization_bindings WHERE treasury_binding_id=p_treasury AND saved_method_id=p_method FOR SHARE;
  IF stored.transaction_id IS DISTINCT FROM p_transaction OR stored.customer_id IS DISTINCT FROM p_customer
    OR stored.merchant_id IS DISTINCT FROM p_merchant OR stored.integration_id IS DISTINCT FROM p_integration
    OR stored.authorization_code IS DISTINCT FROM p_receipt#>>'{authorization,authorization_code}'
    OR stored.authorization_signature IS DISTINCT FROM p_receipt#>>'{authorization,signature}'
    OR stored.paystack_customer_code IS DISTINCT FROM p_receipt#>>'{customer,customer_code}'
    OR stored.email IS DISTINCT FROM p_receipt#>>'{customer,email}'
    OR stored.provider_transaction_id IS DISTINCT FROM p_receipt->>'id'
    OR stored.provider_reference IS DISTINCT FROM p_receipt->>'reference'
    OR stored.system_identifier IS DISTINCT FROM p_system OR stored.database_name IS DISTINCT FROM current_database()
    OR stored.authorized_login IS DISTINCT FROM worker THEN
    RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('savedMethodId',stored.saved_method_id,'transactionId',stored.transaction_id,'outcome','duplicate');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;

CREATE FUNCTION prefunded_card.read_authorization(
  p_treasury uuid,p_integration uuid,p_merchant uuid,p_customer uuid,p_method uuid,p_system text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored prefunded_card.authorization_bindings%ROWTYPE; method public.customer_saved_payment_methods%ROWTYPE;
DECLARE eligible boolean; reusable boolean;
BEGIN
  PERFORM prefunded_card.authorization_scope(p_treasury,p_integration,p_merchant,p_system,false);
  SELECT * INTO stored FROM prefunded_card.authorization_bindings WHERE treasury_binding_id=p_treasury
    AND integration_id=p_integration AND merchant_id=p_merchant AND customer_id=p_customer AND saved_method_id=p_method
    AND authorized_login=session_user AND system_identifier=p_system AND database_name=current_database() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO method FROM public.customer_saved_payment_methods WHERE id=stored.saved_method_id FOR SHARE;
  eligible:=FOUND AND method.merchant_id=stored.merchant_id AND method.customer_id=stored.customer_id
    AND method.provider='paystack' AND method.provider_customer_email=stored.email
    AND method.authorization_code=stored.authorization_code AND method.authorization_signature=stored.authorization_signature
    AND method.authorization_data->>'authorization_code'=stored.authorization_code
    AND method.authorization_data->>'signature'=stored.authorization_signature
    AND method.authorization_data->>'channel'='card' AND method.authorization_data->'reusable'='true'::jsonb
    AND method.is_active AND method.disabled_at IS NULL;
  PERFORM id FROM public.customers WHERE id=stored.customer_id AND merchant_id=stored.merchant_id FOR SHARE;
  eligible:=eligible AND FOUND;
  reusable:=coalesce(method.reusable,false) AND stored.reusable;
  RETURN jsonb_build_object('savedMethodId',stored.saved_method_id,'merchantId',stored.merchant_id,
    'customerId',stored.customer_id,'email',stored.email,'authorizationCode',stored.authorization_code,
    'paystackCustomerCode',stored.paystack_customer_code,'domain',stored.domain,
    'reusable',reusable,'active',coalesce(eligible,false));
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded authorization denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb),
  prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- source: customer-consent.sql
CREATE TABLE prefunded_card.customer_consents (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  actor_id uuid NOT NULL,
  consent_version text NOT NULL CHECK (consent_version='prefunded-card-v1'),
  one_time_charge boolean NOT NULL CHECK (one_time_charge),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  authorized_login name NOT NULL,
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  database_name name NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX prefunded_customer_consent_actor_idx ON prefunded_card.customer_consents(actor_id);
ALTER TABLE prefunded_card.customer_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_customer_consents_deny ON prefunded_card.customer_consents USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.customer_consents FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_customer_consent_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END $$;
CREATE TRIGGER prefunded_customer_consent_immutable BEFORE UPDATE OR DELETE ON prefunded_card.customer_consents
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_customer_consent_mutation();
CREATE TRIGGER prefunded_customer_consent_no_truncate BEFORE TRUNCATE ON prefunded_card.customer_consents
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_customer_consent_mutation();

CREATE FUNCTION prefunded_card.record_customer_consent(p_operation uuid,p_actor uuid,p_consent jsonb,p_system text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  IF p_consent IS DISTINCT FROM '{"version":"prefunded-card-v1","oneTimeCharge":true}'::jsonb
    OR current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  SELECT stored.* INTO STRICT operation FROM prefunded_card.operations stored
    JOIN prefunded_card.treasury_bindings treasury ON treasury.id=stored.treasury_binding_id
      AND treasury.integration_id=stored.integration_id AND treasury.merchant_id=stored.merchant_id
      AND treasury.authorized_login=session_user
    JOIN public.customers customer ON customer.id=stored.customer_id AND customer.merchant_id=stored.merchant_id
      AND customer.user_id=p_actor
    WHERE stored.id=p_operation FOR SHARE OF stored,treasury,customer;
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  INSERT INTO prefunded_card.customer_consents(operation_id,actor_id,consent_version,one_time_charge,
    request_fingerprint,authorized_login,system_identifier,database_name)
    VALUES(operation.id,p_actor,'prefunded-card-v1',true,operation.request_fingerprint,session_user,p_system,current_database());
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501'; END IF;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.reject_customer_consent_mutation(),
  prefunded_card.record_customer_consent(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- source: customer-entry.sql
CREATE FUNCTION prefunded_card.customer_result(p_operation uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('operationId',id,'goalId',goal_id,'amountKobo',amount_kobo,'currency',currency,
    'status',CASE WHEN collection_status IN ('reversed','action_required') OR transfer_status='verified_failed'
      OR projection_status='reconciliation_required' THEN 'reconciliation_required'
      WHEN projection_status='applied' THEN 'completed'
      WHEN collection_status='verified_failed' THEN 'collection_failed' ELSE 'pending' END)
  FROM prefunded_card.operations WHERE id=p_operation
$$;

CREATE FUNCTION prefunded_card.customer_command(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb,p_create boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury prefunded_card.treasury_bindings%ROWTYPE; mapped record;
DECLARE existing prefunded_card.operations%ROWTYPE; operation_id uuid; key_hash text; fingerprint text;
DECLARE command jsonb; count_bindings integer; authorization_proof jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded customer identity refused' USING ERRCODE='42501';
  END IF;
  IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_create IS NULL
    OR p_input->>'goalId' IS DISTINCT FROM p_goal::text
    OR (p_input->>'idempotencyKey')::uuid IS NULL
    OR (SELECT count(*) FROM jsonb_object_keys(p_input))<>(CASE WHEN p_create THEN 5 ELSE 2 END)
    OR NOT p_input ?& (CASE WHEN p_create THEN ARRAY['goalId','idempotencyKey','amountKobo','savedMethodId','consent']
      ELSE ARRAY['goalId','idempotencyKey'] END) THEN
    RAISE EXCEPTION 'prefunded customer input refused' USING ERRCODE='22023';
  END IF;
  IF p_create AND (p_input->'consent' IS DISTINCT FROM '{"version":"prefunded-card-v1","oneTimeCharge":true}'::jsonb
    OR jsonb_typeof(p_input->'amountKobo') IS DISTINCT FROM 'number'
    OR (p_input->>'amountKobo') !~ '^[1-9][0-9]{0,15}$'
    OR (p_input->>'amountKobo')::numeric>9007199254740991
    OR (p_input->>'savedMethodId')::uuid IS NULL) THEN
    RAISE EXCEPTION 'prefunded customer amount refused' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO count_bindings FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user;
  IF count_bindings<>1 THEN RAISE EXCEPTION 'prefunded customer treasury refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT treasury FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user FOR UPDATE;
  PERFORM customer.id FROM public.customers customer JOIN public.customer_savings_goals goal
    ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
      AND goal.id=p_goal FOR SHARE OF customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer scope refused' USING ERRCODE='42501'; END IF;
  key_hash:=encode(sha256(convert_to(jsonb_build_array(p_integration,p_merchant,p_customer,p_goal,
    (p_input->>'idempotencyKey')::uuid)::text,'UTF8')),'hex');
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_integration,p_merchant,p_customer,p_goal,
    p_actor,(p_input->>'savedMethodId')::uuid,p_input->'amountKobo',p_input->'consent')::text,'UTF8')),'hex');
  SELECT * INTO existing FROM prefunded_card.operations WHERE integration_id=p_integration AND idempotency_key=key_hash FOR UPDATE;
  IF FOUND THEN
    PERFORM prefunded_card.require_credit_route(existing,p_system);
    IF existing.merchant_id<>p_merchant OR existing.customer_id<>p_customer OR existing.goal_id<>p_goal
      OR existing.treasury_binding_id<>treasury.id THEN
      RAISE EXCEPTION 'prefunded customer scope refused' USING ERRCODE='42501';
    END IF;
    IF p_create AND existing.request_fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'prefunded customer idempotency conflict' USING ERRCODE='23505';
    END IF;
    IF p_create AND NOT EXISTS(SELECT 1 FROM prefunded_card.customer_consents consent
      WHERE consent.operation_id=existing.id AND consent.actor_id=p_actor
        AND consent.consent_version='prefunded-card-v1' AND consent.one_time_charge
        AND consent.request_fingerprint=fingerprint AND consent.authorized_login=session_user
        AND consent.system_identifier=p_system AND consent.database_name=current_database()) THEN
      RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501';
    END IF;
    RETURN prefunded_card.customer_result(existing.id);
  END IF;
  IF NOT p_create THEN RAISE EXCEPTION 'prefunded customer operation unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM id FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=p_merchant
    AND customer_id=p_customer AND goal_kind='legacy' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer goal unavailable' USING ERRCODE='42501'; END IF;
  authorization_proof:=prefunded_card.read_authorization(treasury.id,p_integration,p_merchant,p_customer,
    (p_input->>'savedMethodId')::uuid,p_system);
  IF authorization_proof->'active' IS DISTINCT FROM 'true'::jsonb OR authorization_proof->'reusable' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'prefunded customer card unavailable' USING ERRCODE='42501';
  END IF;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND customer_id=p_customer AND goal_id=p_goal FOR SHARE;
  operation_id:=gen_random_uuid();
  command:=jsonb_build_object('operationId',operation_id,'integrationId',p_integration,'merchantId',p_merchant,
    'customerId',p_customer,'goalId',p_goal,'treasuryBindingId',treasury.id,'requestFingerprint',fingerprint,
    'idempotencyKey',key_hash,'savedMethodId',p_input->>'savedMethodId','amountKobo',p_input->'amountKobo',
    'feeAllowanceKobo',0,'currency','NGN','collectionReference','pvbc-'||operation_id,
    'transferReference','pvbt-'||operation_id,'destinationWalletId',mapped.provider_wallet_id,
    'destinationCustomerId',mapped.provider_customer_id);
  PERFORM prefunded_card.reserve(command);
  PERFORM prefunded_card.record_customer_consent(operation_id,p_actor,p_input->'consent',p_system);
  RETURN prefunded_card.customer_result(operation_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer request unavailable' USING ERRCODE='42501';
END $$;

CREATE FUNCTION prefunded_card.customer_request(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT prefunded_card.customer_command(p_integration,p_merchant,p_customer,p_goal,p_actor,p_business,p_system,p_input,true)
$$;
CREATE FUNCTION prefunded_card.customer_status(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT prefunded_card.customer_command(p_integration,p_merchant,p_customer,p_goal,p_actor,p_business,p_system,p_input,false)
$$;
REVOKE ALL ON FUNCTION prefunded_card.customer_result(uuid),
  prefunded_card.customer_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,boolean),
  prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),
  prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: customer-capability.sql
CREATE FUNCTION prefunded_card.customer_capabilities(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury prefunded_card.treasury_bindings%ROWTYPE;
DECLARE route_context prefunded_card.operations%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE; candidate record; proof jsonb;
DECLARE saved_methods jsonb:='[]'::jsonb; disabled jsonb; pending_kobo numeric; principal_kobo numeric;
DECLARE remaining_kobo numeric; count_bindings integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_input IS DISTINCT FROM jsonb_build_object('goalId',p_goal::text) THEN
    RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  PERFORM customer.id FROM public.customers customer JOIN public.customer_savings_goals owned
    ON owned.customer_id=customer.id AND owned.merchant_id=customer.merchant_id
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
      AND owned.id=p_goal FOR SHARE OF customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=p_business FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501'; END IF;
  disabled:=jsonb_build_object('goalId',p_goal,'enabled',false,'newCardEnabled',false,'currency','NGN',
    'maximumAmountKobo',0,'savedMethods','[]'::jsonb);
  SELECT count(*) INTO count_bindings FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user;
  IF count_bindings<>1 THEN RETURN disabled; END IF;
  SELECT binding.* INTO treasury FROM prefunded_card.treasury_bindings binding
    WHERE binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.expected_business_id=p_business AND binding.authorized_login=session_user
      AND binding.enabled AND binding.currency='NGN' FOR UPDATE OF binding;
  IF NOT FOUND THEN RETURN disabled; END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=treasury.id AND identity.integration_id=treasury.integration_id
      AND identity.merchant_id=treasury.merchant_id AND identity.expected_business_id=treasury.expected_business_id
      AND identity.source_wallet_id=treasury.source_wallet_id AND identity.authorized_login=treasury.authorized_login
    FOR SHARE OF identity;
  IF NOT FOUND THEN RETURN disabled; END IF;
  PERFORM prefunded_card.authorization_scope(treasury.id,p_integration,p_merchant,p_system,false);
  IF NOT prefunded_card.treasury_reservation_ready(treasury.id) THEN RETURN disabled; END IF;
  PERFORM route.goal_id FROM prefunded_card.credit_routes route
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id
      AND binding.integration_id=route.integration_id AND binding.merchant_id=route.merchant_id
      AND binding.customer_id=route.customer_id AND binding.enabled AND binding.authorized_login=session_user
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.goal_id=route.goal_id
      AND mapping.integration_id=route.integration_id AND mapping.merchant_id=route.merchant_id
      AND mapping.customer_id=route.customer_id AND mapping.provider_wallet_id<>treasury.source_wallet_id
    WHERE route.goal_id=p_goal AND route.integration_id=p_integration AND route.merchant_id=p_merchant
      AND route.customer_id=p_customer AND route.system_identifier=p_system FOR SHARE OF route,binding,mapping;
  IF NOT FOUND THEN RETURN disabled; END IF;
  route_context.integration_id:=p_integration; route_context.merchant_id:=p_merchant;
  route_context.customer_id:=p_customer; route_context.goal_id:=p_goal; route_context.treasury_binding_id:=treasury.id;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT route_context.destination_wallet_id,route_context.destination_customer_id
    FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id=p_integration AND merchant_id=p_merchant
      AND customer_id=p_customer AND goal_id=p_goal;
  PERFORM prefunded_card.require_credit_route(route_context,p_system);
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=p_merchant
    AND customer_id=p_customer AND goal_kind='legacy' AND status='active' AND completed_at IS NULL AND cancelled_at IS NULL
    AND spent_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN disabled; END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO principal_kobo FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    WHERE operation.goal_id=p_goal AND operation.integration_id=p_integration AND posting.account='principal';
  IF principal_kobo IS DISTINCT FROM goal.current_amount*100 THEN RETURN disabled; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations WHERE goal_id=p_goal
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  remaining_kobo:=greatest(0,(goal.target_amount-goal.current_amount)*100-pending_kobo);
  IF remaining_kobo>9007199254740991 OR trunc(remaining_kobo)<>remaining_kobo THEN RETURN disabled; END IF;
  FOR candidate IN
    SELECT method.id,btrim(method.brand) AS brand,method.last4 FROM public.customer_saved_payment_methods method
      JOIN prefunded_card.authorization_bindings binding ON binding.saved_method_id=method.id
        AND binding.treasury_binding_id=treasury.id AND binding.integration_id=p_integration
        AND binding.merchant_id=p_merchant AND binding.customer_id=p_customer
        AND binding.system_identifier=p_system AND binding.database_name=current_database()
        AND binding.authorized_login=session_user AND binding.reusable
      WHERE method.merchant_id=p_merchant AND method.customer_id=p_customer AND method.provider='paystack'
        AND method.is_active AND method.reusable AND method.disabled_at IS NULL
        AND octet_length(btrim(method.brand)) BETWEEN 1 AND 64 AND method.brand !~ '[[:cntrl:]]'
        AND method.last4 ~ '^[0-9]{4}$' ORDER BY method.id LIMIT 20 FOR SHARE OF method,binding
  LOOP
    proof:=prefunded_card.read_authorization(treasury.id,p_integration,p_merchant,p_customer,candidate.id,p_system);
    IF proof->'active'='true'::jsonb AND proof->'reusable'='true'::jsonb THEN
      saved_methods:=saved_methods||jsonb_build_array(jsonb_build_object('id',candidate.id,'brand',candidate.brand,'last4',candidate.last4));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('goalId',p_goal,'enabled',remaining_kobo>0 AND jsonb_array_length(saved_methods)>0
      AND treasury.verified_available_kobo-treasury.reserved_kobo-treasury.consumed_kobo>0,
    'newCardEnabled',false,'currency','NGN','maximumAmountKobo',remaining_kobo,'savedMethods',saved_methods);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer capability unavailable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: dispatch-queue.sql
CREATE TABLE prefunded_card.dispatch_queue (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_token uuid,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  attempts bigint NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
ALTER TABLE prefunded_card.dispatch_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.dispatch_queue FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX prefunded_card_dispatch_due ON prefunded_card.dispatch_queue(available_at) WHERE finished_at IS NULL;
CREATE FUNCTION prefunded_card.enqueue_dispatch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO prefunded_card.dispatch_queue(operation_id) VALUES(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_card_enqueue AFTER INSERT ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.enqueue_dispatch();
INSERT INTO prefunded_card.dispatch_queue(operation_id)
  SELECT id FROM prefunded_card.operations WHERE transfer_status IN ('dispatching','pending','unknown')
    OR (projection_status='unapplied'
      AND collection_status NOT IN ('verified_failed','reversed','action_required'));

CREATE FUNCTION prefunded_card.claim_due(p_integration uuid,p_business text,p_system text,p_limit integer,p_merchant uuid,p_treasury uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; candidate record; token uuid; result jsonb:='[]';
BEGIN
  IF p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
    OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'prefunded dispatch identity refused' USING ERRCODE='42501';
  END IF;
  FOR binding IN SELECT * FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration
    AND expected_business_id=p_business AND authorized_login=session_user
    AND merchant_id=p_merchant AND id=p_treasury ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    FOR candidate IN SELECT queue.operation_id FROM prefunded_card.dispatch_queue queue
      JOIN prefunded_card.operations operation ON operation.id=queue.operation_id
      WHERE operation.treasury_binding_id=binding.id AND operation.integration_id=p_integration
        AND queue.finished_at IS NULL AND queue.available_at<=clock_timestamp()
        AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at<=clock_timestamp())
      ORDER BY queue.available_at,queue.operation_id LIMIT (p_limit-jsonb_array_length(result))
      FOR UPDATE OF queue SKIP LOCKED LOOP
      token:=gen_random_uuid();
      UPDATE prefunded_card.dispatch_queue SET claim_token=token,lease_expires_at=clock_timestamp()+interval '120 seconds',
        attempts=attempts+1 WHERE operation_id=candidate.operation_id;
      result:=result||jsonb_build_array(jsonb_build_object('operationId',candidate.operation_id,'token',token));
    END LOOP;
    EXIT WHEN jsonb_array_length(result)>=p_limit;
  END LOOP;
  RETURN result;
END $$;
CREATE FUNCTION prefunded_card.finish_dispatch(p_operation uuid,p_token uuid,p_system text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  UPDATE prefunded_card.dispatch_queue SET claim_token=NULL,lease_expires_at=NULL,
    available_at=clock_timestamp()+interval '30 seconds',
    finished_at=CASE WHEN operation.transfer_status IN ('dispatching','pending','unknown') THEN NULL
      WHEN operation.projection_status IN ('applied','reconciliation_required')
      OR operation.collection_status IN ('verified_failed','reversed','action_required')
      OR operation.transfer_status='verified_failed' THEN clock_timestamp() ELSE NULL END
    WHERE operation_id=p_operation AND claim_token=p_token AND lease_expires_at>clock_timestamp();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.enqueue_dispatch(),prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),
  prefunded_card.finish_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- source: evidence-storage.sql
CREATE TABLE prefunded_card.evidence_authorities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_staging.integrations(id),
  business_id text COLLATE "C" NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  system_identifier text NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  ingestion_login name NOT NULL,
  reader_login name NOT NULL,
  currency text NOT NULL CHECK (currency='NGN'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE prefunded_card.provider_evidence (
  integration_id uuid NOT NULL REFERENCES prefunded_card.evidence_authorities(integration_id),
  event_id text COLLATE "C" NOT NULL CHECK (octet_length(event_id) BETWEEN 1 AND 512),
  fingerprint text COLLATE "C" NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object'),
  business_id text COLLATE "C" NOT NULL,
  ingestion_login name NOT NULL,
  conflicted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id)
);
CREATE INDEX prefunded_evidence_transaction_idx ON prefunded_card.provider_evidence
  (integration_id,(observation->>'providerTransactionId'));
CREATE INDEX prefunded_evidence_reference_idx ON prefunded_card.provider_evidence USING gin((observation->'references'));
CREATE TABLE prefunded_card.inflow_attributions (
  integration_id uuid NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  result jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE TABLE prefunded_card.evidence_conflicts (
  integration_id uuid NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  already_applied boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,operation_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE INDEX prefunded_evidence_conflict_operation_idx ON prefunded_card.evidence_conflicts(operation_id);
ALTER TABLE prefunded_card.evidence_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.provider_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.inflow_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.evidence_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_evidence_authorities_deny ON prefunded_card.evidence_authorities USING(false) WITH CHECK(false);
CREATE POLICY prefunded_provider_evidence_deny ON prefunded_card.provider_evidence USING(false) WITH CHECK(false);
CREATE POLICY prefunded_inflow_attributions_deny ON prefunded_card.inflow_attributions USING(false) WITH CHECK(false);
CREATE POLICY prefunded_evidence_conflicts_deny ON prefunded_card.evidence_conflicts USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.evidence_authorities,prefunded_card.provider_evidence,prefunded_card.inflow_attributions,prefunded_card.evidence_conflicts
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE TRIGGER prefunded_evidence_authority_immutable BEFORE UPDATE OR DELETE ON prefunded_card.evidence_authorities
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_authority_no_truncate BEFORE TRUNCATE ON prefunded_card.evidence_authorities
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_conflict_immutable BEFORE UPDATE OR DELETE ON prefunded_card.evidence_conflicts
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_evidence_conflict_no_truncate BEFORE TRUNCATE ON prefunded_card.evidence_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();

CREATE FUNCTION prefunded_card.evidence_scope(p_integration uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority prefunded_card.evidence_authorities%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS NULL OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'provider evidence database refused' USING ERRCODE='42501';
  END IF;
  SELECT * INTO authority FROM prefunded_card.evidence_authorities WHERE integration_id=p_integration
    AND system_identifier=p_system AND enabled AND session_user IN (ingestion_login,reader_login) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence authority refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=authority.business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence registry refused' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('businessId',authority.business_id,'currency',authority.currency);
END $$;
REVOKE ALL ON FUNCTION prefunded_card.evidence_scope(uuid,text) FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE FUNCTION prefunded_card.evidence_destination_mapping(p_integration uuid,p_system text,p_wallet text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  SELECT jsonb_build_object('providerWalletId',mapping.provider_wallet_id,'providerCustomerId',mapping.provider_customer_id)
    INTO result FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.integration_id=mapping.integration_id AND route.goal_id=mapping.goal_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=p_wallet;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.evidence_destination_mapping(uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-projection-storage.sql
CREATE TABLE prefunded_card.bank_projections (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  event_id text COLLATE "C" NOT NULL,
  operation_id uuid NOT NULL UNIQUE REFERENCES piggyvest_savings_ledger.operations(id),
  contribution_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_contributions(id) DEFERRABLE INITIALLY DEFERRED,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY(integration_id,provider_transaction_id),
  FOREIGN KEY(integration_id,event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id),
  FOREIGN KEY(integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE INDEX prefunded_bank_projection_merchant_idx ON prefunded_card.bank_projections(merchant_id);
CREATE INDEX prefunded_bank_projection_customer_idx ON prefunded_card.bank_projections(customer_id);
CREATE INDEX prefunded_bank_projection_goal_idx ON prefunded_card.bank_projections(goal_id);
CREATE INDEX prefunded_bank_projection_event_idx ON prefunded_card.bank_projections(integration_id,event_id);
CREATE TABLE prefunded_card.bank_evidence_conflicts (
  integration_id uuid NOT NULL,
  provider_transaction_id text COLLATE "C" NOT NULL,
  conflicting_event_id text COLLATE "C" NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,provider_transaction_id,conflicting_event_id),
  FOREIGN KEY(integration_id,provider_transaction_id) REFERENCES prefunded_card.bank_projections(integration_id,provider_transaction_id),
  FOREIGN KEY(integration_id,conflicting_event_id) REFERENCES prefunded_card.provider_evidence(integration_id,event_id)
);
CREATE INDEX prefunded_bank_conflict_event_idx ON prefunded_card.bank_evidence_conflicts(integration_id,conflicting_event_id);
ALTER TABLE prefunded_card.bank_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.bank_evidence_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_bank_projections_deny ON prefunded_card.bank_projections USING(false) WITH CHECK(false);
CREATE POLICY prefunded_bank_conflicts_deny ON prefunded_card.bank_evidence_conflicts USING(false) WITH CHECK(false);
REVOKE ALL ON prefunded_card.bank_projections,prefunded_card.bank_evidence_conflicts FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
CREATE TRIGGER prefunded_bank_projection_immutable BEFORE UPDATE OR DELETE ON prefunded_card.bank_projections
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_projection_no_truncate BEFORE TRUNCATE ON prefunded_card.bank_projections
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_conflict_immutable BEFORE UPDATE OR DELETE ON prefunded_card.bank_evidence_conflicts
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
CREATE TRIGGER prefunded_bank_conflict_no_truncate BEFORE TRUNCATE ON prefunded_card.bank_evidence_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_projection_mutation();
DO $$ DECLARE definition text; BEGIN
  SELECT regexp_replace(lower(pg_get_constraintdef(oid)),'[[:space:]()]|::text(\[\])?','','g') INTO definition
    FROM pg_constraint WHERE conrelid='public.customer_savings_contributions'::regclass
      AND conname='customer_savings_contributions_source_type_check';
  IF definition='checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'']' THEN
    ALTER TABLE public.customer_savings_contributions DROP CONSTRAINT customer_savings_contributions_source_type_check;
    ALTER TABLE public.customer_savings_contributions ADD CONSTRAINT customer_savings_contributions_source_type_check
      CHECK (source_type=ANY(ARRAY['wallet','paystack_authorization','manual_adjustment','piggyvest_inflow']::text[]));
  ELSIF definition IS DISTINCT FROM 'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'',''piggyvest_inflow'']' THEN
    RAISE EXCEPTION 'unexpected savings contribution source constraint';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION prefunded_card.guard_contribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_goal uuid; valid boolean;
BEGIN
  selected_goal:=CASE WHEN TG_OP='DELETE' THEN OLD.goal_id ELSE NEW.goal_id END;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=selected_goal)
    AND (TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=OLD.goal_id)) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT true INTO valid FROM prefunded_card.projections projection
      JOIN prefunded_card.operations operation ON operation.id=projection.operation_id
      WHERE projection.contribution_id=NEW.id AND projection.created_xid=pg_current_xact_id()
        AND operation.goal_id=NEW.goal_id AND operation.merchant_id=NEW.merchant_id AND operation.customer_id=NEW.customer_id
        AND projection.amount_kobo::numeric/100=NEW.amount AND NEW.status='completed'
        AND NEW.source_type='paystack_authorization' AND NEW.idempotency_key='pvb-card:'||operation.id;
    IF valid IS TRUE THEN RETURN NEW; END IF;
    SELECT true INTO valid FROM prefunded_card.bank_projections projection
      WHERE projection.contribution_id=NEW.id AND projection.created_xid=pg_current_xact_id()
        AND projection.goal_id=NEW.goal_id AND projection.merchant_id=NEW.merchant_id AND projection.customer_id=NEW.customer_id
        AND projection.amount_kobo::numeric/100=NEW.amount AND NEW.status='completed'
        AND NEW.source_type='piggyvest_inflow' AND NEW.idempotency_key='pvb-bank:'||projection.operation_id;
    IF valid IS TRUE THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enrolled savings requires canonical contribution projection' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.guard_contribution() FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-conflict.sql
CREATE FUNCTION prefunded_card.fence_provider_evidence_conflict(p_integration uuid,p_event text,p_references jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  FOR operation IN SELECT candidate.* FROM prefunded_card.operations candidate WHERE candidate.integration_id=p_integration
    AND (p_references ? candidate.transfer_reference OR p_references ? candidate.collection_reference
      OR p_references ? candidate.transfer_provider_transaction_id OR p_references ? candidate.collection_provider_transaction_id
      OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias WHERE alias.operation_id=candidate.id
        AND alias.integration_id=p_integration AND p_references ? alias.provider_transaction_id))
    ORDER BY candidate.id FOR UPDATE LOOP
    INSERT INTO prefunded_card.evidence_conflicts(integration_id,event_id,operation_id,already_applied)
      VALUES(p_integration,p_event,operation.id,operation.projection_status='applied') ON CONFLICT DO NOTHING;
    IF operation.projection_status<>'applied' THEN
      UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=operation.id;
    END IF;
  END LOOP;
  INSERT INTO prefunded_card.bank_evidence_conflicts(integration_id,provider_transaction_id,conflicting_event_id)
    SELECT projection.integration_id,projection.provider_transaction_id,p_event FROM prefunded_card.bank_projections projection
      JOIN prefunded_card.provider_evidence receipt ON receipt.integration_id=projection.integration_id AND receipt.event_id=projection.event_id
      WHERE projection.integration_id=p_integration AND (p_references ? projection.provider_transaction_id
        OR (receipt.observation->'references') ?| ARRAY(SELECT jsonb_array_elements_text(p_references)))
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.fence_provider_evidence_conflict(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-record.sql
CREATE FUNCTION prefunded_card.record_provider_evidence(p_integration uuid,p_system text,p_observation jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope jsonb; stored prefunded_card.provider_evidence%ROWTYPE; expected_keys text[];
BEGIN
  scope:=prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND ingestion_login=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence ingestion refused' USING ERRCODE='42501'; END IF;
  expected_keys:=ARRAY['eventId','fingerprint','eventType','eventCategory','status','kind','providerTransactionId',
    'destinationCustomerId','sourceWalletId','destinationWalletId','reference','references','amountKobo','feeKobo','currency',
    'eventDataId','envelopeWalletId','sessionId','creditedAt'];
  IF p_observation IS NULL OR jsonb_typeof(p_observation)<>'object' OR NOT p_observation ?& expected_keys
    OR p_observation-expected_keys<>'{}'::jsonb
    OR coalesce(p_observation->>'status','') NOT IN ('deferred','verified')
    OR coalesce(p_observation->>'kind','') NOT IN ('unknown','bank_inflow','internal_transfer')
    OR coalesce(p_observation->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_observation->'references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid provider evidence' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_observation) field WHERE field.key=ANY(ARRAY[
    'eventId','eventType','eventCategory','destinationCustomerId']) AND
    (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512))
    OR jsonb_array_length(p_observation->'references')>24
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_observation->'references') reference WHERE
      jsonb_typeof(reference)<>'string' OR octet_length(reference#>>'{}') NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'invalid provider evidence identity' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||p_integration,0));
  INSERT INTO prefunded_card.provider_evidence(integration_id,event_id,fingerprint,observation,business_id,ingestion_login)
    VALUES(p_integration,p_observation->>'eventId',p_observation->>'fingerprint',
      p_observation||jsonb_build_object('status','deferred'),scope->>'businessId',session_user) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT stored FROM prefunded_card.provider_evidence WHERE integration_id=p_integration
    AND event_id=p_observation->>'eventId' FOR UPDATE;
  IF stored.fingerprint IS DISTINCT FROM p_observation->>'fingerprint' OR stored.conflicted THEN
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration AND event_id=stored.event_id;
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      coalesce(stored.observation->'references','[]')||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  IF p_observation->>'status'='deferred' THEN
    RETURN CASE WHEN stored.observation->>'status'='verified' THEN 'duplicate' ELSE 'stored' END;
  END IF;
  IF NOT prefunded_card.valid_terminal_evidence(p_observation) OR p_observation->>'currency' IS DISTINCT FROM scope->>'currency'
    OR p_observation->'feeKobo' IS DISTINCT FROM '0'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(p_observation) field WHERE field.key=ANY(ARRAY[
      'providerTransactionId','destinationWalletId','reference']) AND
      (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512))
    OR jsonb_typeof(p_observation->'sourceWalletId') IS DISTINCT FROM 'string'
    OR NOT (p_observation->'references') ? (p_observation->>'reference')
    OR NOT (p_observation->'references') ? (p_observation->>'providerTransactionId') THEN RETURN 'deferred'; END IF;
  IF p_observation->>'kind'='bank_inflow' THEN
    IF p_observation->>'eventType'<>'bank-transfer.inflow.success' OR p_observation->>'eventCategory' NOT IN ('bank-transfer','inflow_transaction')
      OR p_observation->>'sourceWalletId'<>'' THEN RETURN 'deferred'; END IF;
  ELSIF p_observation->>'kind'='internal_transfer' THEN
    IF p_observation->>'eventType'<>'wallet-transfer.outflow.success' OR p_observation->>'eventCategory'<>'wallet-transfer'
      OR coalesce(p_observation->>'sourceWalletId','')='' OR p_observation->>'sourceWalletId'=p_observation->>'destinationWalletId'
      THEN RETURN 'deferred'; END IF;
  ELSE RETURN 'deferred'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.goal_id=mapping.goal_id AND route.integration_id=mapping.integration_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=p_observation->>'destinationWalletId'
      AND mapping.provider_customer_id=p_observation->>'destinationCustomerId' FOR SHARE OF mapping,customer,route;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF stored.observation->>'status'='verified' THEN
    IF stored.observation=p_observation THEN RETURN 'duplicate'; END IF;
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration AND event_id=stored.event_id;
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      coalesce(stored.observation->'references','[]')||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence other WHERE other.integration_id=p_integration
    AND other.observation->>'status'='verified' AND other.observation->>'providerTransactionId'=p_observation->>'providerTransactionId'
    AND other.observation-ARRAY['eventId','fingerprint','references','eventDataId','creditedAt']
      IS DISTINCT FROM p_observation-ARRAY['eventId','fingerprint','references','eventDataId','creditedAt']) THEN
    UPDATE prefunded_card.provider_evidence SET conflicted=true WHERE integration_id=p_integration
      AND (event_id=stored.event_id OR observation->>'providerTransactionId'=p_observation->>'providerTransactionId');
    PERFORM prefunded_card.fence_provider_evidence_conflict(p_integration,stored.event_id,
      (SELECT coalesce(jsonb_agg(reference),'[]') FROM prefunded_card.provider_evidence receipt,
        LATERAL jsonb_array_elements(receipt.observation->'references') reference WHERE receipt.integration_id=p_integration
        AND (receipt.event_id=stored.event_id OR receipt.observation->>'providerTransactionId'=p_observation->>'providerTransactionId'))
        ||(p_observation->'references'));
    RETURN 'conflict';
  END IF;
  UPDATE prefunded_card.provider_evidence SET observation=p_observation
    WHERE integration_id=p_integration AND event_id=stored.event_id;
  RETURN 'stored';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.record_provider_evidence(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-transfer.sql
CREATE FUNCTION prefunded_card.read_transfer_evidence(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; treasury prefunded_card.treasury_bindings%ROWTYPE;
DECLARE evidence prefunded_card.provider_evidence%ROWTYPE; selected jsonb; scope jsonb;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  IF operation.transfer_status='not_started' OR operation.transfer_attempted_at IS NULL THEN
    RETURN jsonb_build_object('outcome','deferred');
  END IF;
  scope:=prefunded_card.evidence_scope(operation.integration_id,p_system);
  SELECT * INTO STRICT treasury FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  IF treasury.expected_business_id IS DISTINCT FROM scope->>'businessId' THEN
    RETURN jsonb_build_object('outcome','reconciliation_required');
  END IF;
  FOR evidence IN SELECT * FROM prefunded_card.provider_evidence WHERE integration_id=operation.integration_id
    AND (observation->'references') ? operation.transfer_reference LOOP
    IF evidence.conflicted THEN RETURN jsonb_build_object('outcome','reconciliation_required'); END IF;
    IF evidence.observation->>'status'<>'verified' THEN CONTINUE; END IF;
    IF evidence.business_id IS DISTINCT FROM treasury.expected_business_id
      OR evidence.observation->>'destinationWalletId' IS DISTINCT FROM operation.destination_wallet_id
      OR evidence.observation->>'destinationCustomerId' IS DISTINCT FROM operation.destination_customer_id
      OR evidence.observation->>'currency' IS DISTINCT FROM operation.currency
      OR (evidence.observation->>'amountKobo')::bigint IS DISTINCT FROM operation.amount_kobo THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    IF evidence.observation->>'kind'='bank_inflow' THEN CONTINUE; END IF;
    IF evidence.observation->>'kind'<>'internal_transfer'
      OR evidence.observation->>'reference' IS DISTINCT FROM operation.transfer_reference
      OR evidence.observation->>'sourceWalletId' IS DISTINCT FROM treasury.source_wallet_id THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    IF selected IS NOT NULL AND selected->>'providerTransactionId' IS DISTINCT FROM evidence.observation->>'providerTransactionId' THEN
      RETURN jsonb_build_object('outcome','reconciliation_required');
    END IF;
    selected:=evidence.observation;
  END LOOP;
  IF selected IS NULL THEN RETURN jsonb_build_object('outcome','deferred'); END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=operation.integration_id AND mapping.goal_id=operation.goal_id
      AND mapping.merchant_id=operation.merchant_id AND mapping.customer_id=operation.customer_id
      AND mapping.provider_wallet_id=selected->>'destinationWalletId'
      AND mapping.provider_customer_id=selected->>'destinationCustomerId' FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','reconciliation_required'); END IF;
  RETURN jsonb_build_object('outcome','verified_success','request',prefunded_card.request_for_operation(operation),'evidence',jsonb_build_object(
    'reference',selected->>'reference','amountKobo',(selected->>'amountKobo')::bigint,'currency',selected->>'currency',
    'businessId',scope->>'businessId','sourceWalletId',selected->>'sourceWalletId',
    'destinationWalletId',selected->>'destinationWalletId','destinationCustomerId',selected->>'destinationCustomerId',
    'providerTransactionId',selected->>'providerTransactionId'));
END $$;
REVOKE ALL ON FUNCTION prefunded_card.read_transfer_evidence(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-inflow.sql
CREATE FUNCTION prefunded_card.classify_provider_inflow(p_integration uuid,p_system text,p_event text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt prefunded_card.provider_evidence%ROWTYPE; observed jsonb; mapped record; result jsonb;
DECLARE operation prefunded_card.operations%ROWTYPE; matched uuid[];
BEGIN
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND reader_login=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence reader refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||p_integration,0));
  SELECT * INTO receipt FROM prefunded_card.provider_evidence WHERE integration_id=p_integration AND event_id=p_event FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','deferred'); END IF;
  observed:=receipt.observation;
  result:=jsonb_build_object('outcome','deferred');
  IF receipt.conflicted THEN result:=jsonb_build_object('outcome','reconciliation_required');
  ELSIF observed->>'status'='verified' THEN
    SELECT mapping.merchant_id,mapping.customer_id,mapping.goal_id INTO mapped
    FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.goal_id=mapping.goal_id AND route.integration_id=mapping.integration_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=mapping.goal_id AND binding.integration_id=mapping.integration_id
      AND binding.merchant_id=mapping.merchant_id AND binding.customer_id=mapping.customer_id
      AND binding.enabled AND binding.authorized_login=session_user
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=observed->>'destinationWalletId'
      AND mapping.provider_customer_id=observed->>'destinationCustomerId';
    IF FOUND THEN
      SELECT array_agg(candidate.id ORDER BY candidate.id) INTO matched FROM prefunded_card.operations candidate WHERE candidate.integration_id=p_integration
        AND ((observed->'references') ? candidate.transfer_reference OR (observed->'references') ? candidate.collection_reference
          OR (observed->'references') ? candidate.collection_provider_transaction_id
          OR (observed->'references') ? candidate.transfer_provider_transaction_id
          OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias WHERE alias.operation_id=candidate.id
            AND alias.integration_id=p_integration AND (observed->'references') ? alias.provider_transaction_id));
      SELECT * INTO operation FROM prefunded_card.operations WHERE id=matched[1];
      IF cardinality(matched)>1 THEN result:=jsonb_build_object('outcome','reconciliation_required');
      ELSIF FOUND THEN
        IF operation.goal_id IS DISTINCT FROM mapped.goal_id OR operation.merchant_id IS DISTINCT FROM mapped.merchant_id
          OR operation.customer_id IS DISTINCT FROM mapped.customer_id OR operation.destination_wallet_id IS DISTINCT FROM observed->>'destinationWalletId'
          OR operation.destination_customer_id IS DISTINCT FROM observed->>'destinationCustomerId'
          OR operation.amount_kobo IS DISTINCT FROM (observed->>'amountKobo')::bigint
          OR NOT (observed->'references') ? operation.transfer_reference THEN
          result:=jsonb_build_object('outcome','reconciliation_required');
        ELSIF EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=operation.id) THEN
          result:=jsonb_build_object('outcome','bridge_duplicate');
        ELSE result:=jsonb_build_object('outcome','bridge_inflight'); END IF;
      ELSIF observed->>'kind'='bank_inflow' AND observed->>'sourceWalletId'='' THEN
        result:=jsonb_build_object('outcome','bank_inflow','eventId',receipt.event_id,'integrationId',receipt.integration_id,
          'merchantId',mapped.merchant_id,'customerId',mapped.customer_id,'goalId',mapped.goal_id,
          'providerTransactionId',observed->>'providerTransactionId','destinationWalletId',observed->>'destinationWalletId',
          'destinationCustomerId',observed->>'destinationCustomerId','reference',observed->>'reference',
          'amountKobo',(observed->>'amountKobo')::bigint,'feeKobo',0,'currency',observed->>'currency');
      END IF;
    END IF;
  END IF;
  INSERT INTO prefunded_card.inflow_attributions(integration_id,event_id,result)
    VALUES(p_integration,p_event,result) ON CONFLICT(integration_id,event_id)
    DO UPDATE SET result=EXCLUDED.result,updated_at=clock_timestamp();
  RETURN result;
END $$;

CREATE FUNCTION prefunded_card.guard_evidence_identifiers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identifiers text[]; selected_operation uuid;
BEGIN
  IF TG_TABLE_NAME='operations' THEN
    identifiers:=ARRAY[NEW.collection_reference,NEW.transfer_reference,NEW.collection_provider_transaction_id,NEW.transfer_provider_transaction_id];
    selected_operation:=NEW.id;
  ELSE identifiers:=ARRAY[NEW.provider_transaction_id]; selected_operation:=NEW.operation_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||NEW.integration_id,0));
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence receipt WHERE receipt.integration_id=NEW.integration_id
    AND receipt.observation->>'status'='verified' AND receipt.observation->>'kind'='bank_inflow'
    AND (receipt.observation->'references') ?| array_remove(identifiers,NULL)
    AND NOT EXISTS(SELECT 1 FROM prefunded_card.operations operation
      WHERE operation.integration_id=NEW.integration_id AND operation.id=selected_operation
        AND (receipt.observation->'references') ? operation.transfer_reference)) THEN
    RAISE EXCEPTION 'provider identity already attributed to bank inflow' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_evidence_bridge_identifiers BEFORE INSERT OR UPDATE OF collection_provider_transaction_id,transfer_provider_transaction_id
  ON prefunded_card.operations FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_evidence_identifiers();
CREATE TRIGGER prefunded_evidence_alias_identifiers BEFORE INSERT ON prefunded_card.provider_aliases
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_evidence_identifiers();
REVOKE ALL ON FUNCTION prefunded_card.classify_provider_inflow(uuid,text,text),prefunded_card.guard_evidence_identifiers()
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-projection.sql
CREATE FUNCTION prefunded_card.apply_classified_inflow(p_integration uuid,p_system text,p_event text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE classified jsonb; receipt prefunded_card.provider_evidence%ROWTYPE; operation prefunded_card.operations%ROWTYPE;
DECLARE saved prefunded_card.bank_projections%ROWTYPE; goal public.customer_savings_goals%ROWTYPE; canonical numeric; reserved numeric;
DECLARE ledger_id uuid:=gen_random_uuid(); contribution uuid:=gen_random_uuid(); ledger_result jsonb; alias_owner uuid;
BEGIN
  classified:=prefunded_card.classify_provider_inflow(p_integration,p_system,p_event);
  IF classified->>'outcome' IN ('deferred','bridge_inflight') THEN RETURN 'deferred'; END IF;
  IF classified->>'outcome'='reconciliation_required' THEN RETURN 'reconciliation_required'; END IF;
  SELECT * INTO STRICT receipt FROM prefunded_card.provider_evidence WHERE integration_id=p_integration AND event_id=p_event;
  IF classified->>'outcome'='bridge_duplicate' THEN
    SELECT candidate.* INTO STRICT operation FROM prefunded_card.operations candidate
      JOIN prefunded_card.projections projection ON projection.operation_id=candidate.id
      WHERE candidate.integration_id=p_integration AND (receipt.observation->'references') ? candidate.transfer_reference;
    INSERT INTO prefunded_card.provider_aliases(integration_id,provider_transaction_id,operation_id)
      VALUES(p_integration,receipt.observation->>'providerTransactionId',operation.id) ON CONFLICT DO NOTHING;
    SELECT operation_id INTO alias_owner FROM prefunded_card.provider_aliases WHERE integration_id=p_integration
      AND provider_transaction_id=receipt.observation->>'providerTransactionId';
    IF alias_owner IS DISTINCT FROM operation.id THEN RAISE EXCEPTION 'provider inflow alias conflict' USING ERRCODE='23505'; END IF;
    RETURN 'duplicate';
  END IF;
  IF classified->>'outcome'<>'bank_inflow' THEN RETURN 'deferred'; END IF;
  PERFORM goal_id FROM piggyvest_savings_ledger.bindings WHERE integration_id=p_integration
    AND goal_id=(classified->>'goalId')::uuid AND merchant_id=(classified->>'merchantId')::uuid
    AND customer_id=(classified->>'customerId')::uuid AND enabled AND authorized_login=session_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank projection scope refused' USING ERRCODE='42501'; END IF;
  PERFORM mapping.goal_id FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=p_integration AND mapping.goal_id=(classified->>'goalId')::uuid
      AND mapping.merchant_id=(classified->>'merchantId')::uuid AND mapping.customer_id=(classified->>'customerId')::uuid
      AND mapping.provider_wallet_id=classified->>'destinationWalletId' AND mapping.provider_customer_id=classified->>'destinationCustomerId'
    FOR SHARE OF mapping,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank projection ownership refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT goal FROM public.customer_savings_goals WHERE id=(classified->>'goalId')::uuid
    AND merchant_id=(classified->>'merchantId')::uuid AND customer_id=(classified->>'customerId')::uuid FOR UPDATE;
  SELECT * INTO saved FROM prefunded_card.bank_projections WHERE integration_id=p_integration
    AND provider_transaction_id=classified->>'providerTransactionId';
  IF FOUND THEN
    IF saved.goal_id IS DISTINCT FROM goal.id OR saved.merchant_id IS DISTINCT FROM goal.merchant_id
      OR saved.customer_id IS DISTINCT FROM goal.customer_id OR saved.amount_kobo IS DISTINCT FROM (classified->>'amountKobo')::bigint THEN
      RAISE EXCEPTION 'bank projection duplicate identity conflict' USING ERRCODE='23505'; END IF;
    RETURN 'duplicate';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.bank_projections projection
    JOIN prefunded_card.provider_evidence earlier ON earlier.integration_id=projection.integration_id AND earlier.event_id=projection.event_id
    WHERE projection.integration_id=p_integration AND (earlier.observation->'references') ?|
      ARRAY(SELECT jsonb_array_elements_text(receipt.observation->'references'))) THEN RETURN 'reconciliation_required'; END IF;
  IF goal.status<>'active' OR goal.completed_at IS NOT NULL OR goal.cancelled_at IS NOT NULL OR goal.spent_at IS NOT NULL THEN RETURN 'deferred'; END IF;
  SELECT coalesce(sum(posting.amount_kobo),0) INTO canonical FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id
    WHERE entry.integration_id=p_integration AND entry.goal_id=goal.id AND posting.account='principal';
  IF canonical IS DISTINCT FROM goal.current_amount*100 THEN RAISE EXCEPTION 'bank projection requires reconciled principal' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(amount_kobo),0) INTO reserved FROM prefunded_card.operations WHERE goal_id=goal.id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  IF goal.current_amount*100+reserved+(classified->>'amountKobo')::bigint>goal.target_amount*100 THEN RETURN 'deferred'; END IF;
  ledger_result:=piggyvest_savings_ledger.apply(p_integration,goal.merchant_id,goal.customer_id,goal.id,
    jsonb_build_object('operationId',ledger_id,'kind','credit_principal','principalKobo',(classified->>'amountKobo')::bigint,
      'interestKobo',0,'evidenceId','pvb-bank:'||ledger_id,'referenceId',NULL));
  IF ledger_result->>'outcome'<>'recorded' OR ledger_result->>'operationId'<>ledger_id::text THEN RAISE EXCEPTION 'bank canonical acknowledgement refused'; END IF;
  INSERT INTO prefunded_card.bank_projections(integration_id,provider_transaction_id,event_id,operation_id,contribution_id,
    merchant_id,customer_id,goal_id,amount_kobo) VALUES(p_integration,classified->>'providerTransactionId',p_event,ledger_id,contribution,
    goal.merchant_id,goal.customer_id,goal.id,(classified->>'amountKobo')::bigint);
  INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount,source_type,status,processed_at,idempotency_key,metadata)
    VALUES(contribution,goal.id,goal.merchant_id,goal.customer_id,(classified->>'amountKobo')::numeric/100,'piggyvest_inflow','completed',clock_timestamp(),
      'pvb-bank:'||ledger_id,jsonb_build_object('funding_model','verified_piggyvest_bank','provider_transaction_id',classified->>'providerTransactionId'));
  UPDATE public.customer_savings_goals SET current_amount=current_amount+(classified->>'amountKobo')::numeric/100,
    status=CASE WHEN current_amount+(classified->>'amountKobo')::numeric/100=target_amount THEN 'completed' ELSE 'active' END,
    completed_at=CASE WHEN current_amount+(classified->>'amountKobo')::numeric/100=target_amount THEN clock_timestamp() ELSE completed_at END,
    updated_at=clock_timestamp() WHERE id=goal.id;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.apply_classified_inflow(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: evidence-legacy.sql
CREATE FUNCTION prefunded_card.apply_verified_legacy_inflow(
  p_provider_transaction_id text,p_event_data_id text,p_event_id text,p_provider_customer_id text,p_wallet_id text,
  p_amount_kobo bigint,p_fee_kobo bigint,p_reference text,p_session_id text,p_credited_at timestamptz
) RETURNS text LANGUAGE plpgsql CALLED ON NULL INPUT SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE integration uuid; receipt prefunded_card.provider_evidence%ROWTYPE; outcome text; system_id text;
BEGIN
  system_id:=(SELECT system_identifier::text FROM pg_control_system());
  IF (SELECT count(*) FROM prefunded_card.evidence_authorities WHERE reader_login=session_user
    AND system_identifier=system_id AND enabled)<>1 THEN
    RAISE EXCEPTION 'bank inflow reader scope refused' USING ERRCODE='42501'; END IF;
  SELECT authority.integration_id INTO STRICT integration FROM prefunded_card.evidence_authorities authority
    WHERE authority.reader_login=session_user AND authority.system_identifier=system_id AND authority.enabled;
  PERFORM prefunded_card.evidence_scope(integration,system_id);
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=integration ORDER BY id FOR UPDATE;
  SELECT * INTO receipt FROM prefunded_card.provider_evidence WHERE integration_id=integration AND event_id=p_event_id FOR UPDATE;
  IF NOT FOUND OR receipt.observation->>'status'<>'verified' THEN RETURN 'deferred'; END IF;
  IF receipt.conflicted THEN RETURN 'reconciliation_required'; END IF;
  IF receipt.observation->>'creditedAt' IS NULL OR receipt.observation->>'eventDataId' IS NULL THEN RETURN 'deferred'; END IF;
  IF receipt.observation->>'kind'<>'bank_inflow' OR receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id
    OR receipt.observation->>'eventDataId' IS DISTINCT FROM p_event_data_id
    OR receipt.observation->>'destinationCustomerId' IS DISTINCT FROM p_provider_customer_id
    OR (receipt.observation->>'destinationWalletId' IS DISTINCT FROM p_wallet_id AND receipt.observation->>'envelopeWalletId' IS DISTINCT FROM p_wallet_id)
    OR (receipt.observation->>'amountKobo')::bigint IS DISTINCT FROM p_amount_kobo OR p_fee_kobo IS DISTINCT FROM 0
    OR receipt.observation->>'reference' IS DISTINCT FROM p_reference OR receipt.observation->>'sessionId' IS DISTINCT FROM p_session_id
    OR (receipt.observation->>'creditedAt')::timestamptz IS DISTINCT FROM p_credited_at THEN
    RETURN 'reconciliation_required';
  END IF;
  outcome:=prefunded_card.apply_classified_inflow(integration,system_id,p_event_id);
  RETURN CASE WHEN outcome='applied' THEN 'recognized' ELSE outcome END;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;

-- source: reversal-storage.sql
CREATE TABLE prefunded_card.collection_reversal_events (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  event_id text COLLATE "C" NOT NULL CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  operation_id uuid NOT NULL REFERENCES prefunded_card.operations(id),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  verified_by name NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (integration_id,event_id)
);
CREATE INDEX prefunded_reversal_events_operation_idx ON prefunded_card.collection_reversal_events(operation_id);
CREATE TABLE prefunded_card.collection_reversal_obligations (
  operation_id uuid PRIMARY KEY REFERENCES prefunded_card.operations(id),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  first_event_id text COLLATE "C" NOT NULL,
  collection_amount_kobo bigint NOT NULL CHECK (collection_amount_kobo BETWEEN 1 AND 9007199254740991),
  transfer_status_at_recording text NOT NULL,
  transfer_transaction_id_at_recording text,
  projection_status_at_recording text NOT NULL,
  exposure text NOT NULL CHECK (exposure IN ('transfer_not_started','transfer_in_flight','transfer_completed','transfer_failed')),
  reserved_kobo_at_recording bigint NOT NULL CHECK (reserved_kobo_at_recording >= 0),
  consumed_kobo_at_recording bigint NOT NULL CHECK (consumed_kobo_at_recording >= 0),
  obligation text NOT NULL DEFAULT 'review_required' CHECK (obligation='review_required'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (integration_id,first_event_id) REFERENCES prefunded_card.collection_reversal_events(integration_id,event_id),
  FOREIGN KEY (integration_id,merchant_id,customer_id,goal_id)
    REFERENCES piggyvest_savings_ledger.bindings(integration_id,merchant_id,customer_id,goal_id)
);
CREATE INDEX prefunded_reversal_obligations_event_idx ON prefunded_card.collection_reversal_obligations(integration_id,first_event_id);
CREATE INDEX prefunded_reversal_obligations_binding_idx ON prefunded_card.collection_reversal_obligations(integration_id,merchant_id,customer_id,goal_id);
CREATE INDEX prefunded_reversal_obligations_treasury_idx ON prefunded_card.collection_reversal_obligations(treasury_binding_id);
ALTER TABLE prefunded_card.collection_reversal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefunded_card.collection_reversal_obligations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prefunded_card.collection_reversal_events,prefunded_card.collection_reversal_obligations
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION prefunded_card.reject_reversal_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'prefunded reversal evidence immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER prefunded_reversal_events_immutable BEFORE UPDATE OR DELETE ON prefunded_card.collection_reversal_events
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_events_no_truncate BEFORE TRUNCATE ON prefunded_card.collection_reversal_events
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_obligations_immutable BEFORE UPDATE OR DELETE ON prefunded_card.collection_reversal_obligations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
CREATE TRIGGER prefunded_reversal_obligations_no_truncate BEFORE TRUNCATE ON prefunded_card.collection_reversal_obligations
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.reject_reversal_mutation();
REVOKE ALL ON FUNCTION prefunded_card.reject_reversal_mutation() FROM PUBLIC,anon,authenticated,service_role;

-- source: reversal-guard.sql
CREATE FUNCTION prefunded_card.guard_collection_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.collection_status='reversed' AND (NEW.collection_status<>'reversed'
    OR NEW.collection_provider_transaction_id IS DISTINCT FROM OLD.collection_provider_transaction_id) THEN
    RAISE EXCEPTION 'prefunded collection reversal is terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.collection_status='reversed' OR EXISTS (
    SELECT 1 FROM prefunded_card.collection_reversal_obligations WHERE operation_id=OLD.id
  ) THEN
    IF (OLD.collection_status='not_started' AND NEW.collection_status='dispatching')
      OR (OLD.transfer_status='not_started' AND NEW.transfer_status='dispatching')
      OR (OLD.projection_status<>'applied' AND NEW.projection_status='applied') THEN
      RAISE EXCEPTION 'prefunded reversal requires reconciliation' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_collection_reversal_guard BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_collection_reversal();
REVOKE ALL ON FUNCTION prefunded_card.guard_collection_reversal() FROM PUBLIC,anon,authenticated,service_role;

-- source: reversal-functions.sql
CREATE FUNCTION prefunded_card.lock_reversal_operation(p_operation uuid,p_system text)
RETURNS prefunded_card.operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  PERFORM goal.id FROM public.customer_savings_goals goal
    JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
    WHERE goal.id=operation.goal_id AND goal.merchant_id=operation.merchant_id AND goal.customer_id=operation.customer_id
    FOR SHARE OF goal,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded reversal ownership refused' USING ERRCODE='42501'; END IF;
  RETURN operation;
END $$;
CREATE FUNCTION prefunded_card.read_reversal_context(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_reversal_operation(p_operation,p_system);
  RETURN jsonb_build_object('request',prefunded_card.request_for_operation(operation),
    'collectionTransactionId',operation.collection_provider_transaction_id);
END $$;

CREATE FUNCTION prefunded_card.record_collection_reversal(p_system text,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; existing prefunded_card.collection_reversal_events%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; obligation prefunded_card.collection_reversal_obligations%ROWTYPE;
DECLARE event_key text; outcome text:='recorded'; field_name text;
BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>14
    OR NOT p_evidence ?& ARRAY['operationId','integrationId','merchantId','customerId','goalId','treasuryBindingId',
      'savedMethodId','eventId','collectionReference','collectionTransactionId','collectionAmountKobo','currency','providerStatus','domain'] THEN
    RAISE EXCEPTION 'invalid prefunded reversal evidence' USING ERRCODE='22023';
  END IF;
  FOR field_name IN SELECT jsonb_object_keys(p_evidence) LOOP
    IF jsonb_typeof(p_evidence->field_name) IS DISTINCT FROM
      (CASE WHEN field_name='collectionAmountKobo' THEN 'number' ELSE 'string' END) THEN
      RAISE EXCEPTION 'invalid prefunded reversal field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (p_evidence->>'collectionAmountKobo') !~ '^[1-9][0-9]{0,15}$'
    OR (p_evidence->>'collectionAmountKobo')::numeric>9007199254740991
    OR (p_evidence->>'collectionTransactionId') !~ '^[1-9][0-9]{0,19}$'
    OR (p_evidence->>'collectionTransactionId')::numeric>18446744073709551615
    OR (p_evidence->>'eventId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR (p_evidence->>'collectionReference') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR p_evidence->>'currency'<>'NGN' OR p_evidence->>'providerStatus'<>'reversed' OR p_evidence->>'domain'<>'test' THEN
    RAISE EXCEPTION 'invalid prefunded reversal values' USING ERRCODE='22023';
  END IF;
  operation:=prefunded_card.lock_reversal_operation((p_evidence->>'operationId')::uuid,p_system);
  IF operation.integration_id::text IS DISTINCT FROM p_evidence->>'integrationId'
    OR operation.merchant_id::text IS DISTINCT FROM p_evidence->>'merchantId'
    OR operation.customer_id::text IS DISTINCT FROM p_evidence->>'customerId'
    OR operation.goal_id::text IS DISTINCT FROM p_evidence->>'goalId'
    OR operation.treasury_binding_id::text IS DISTINCT FROM p_evidence->>'treasuryBindingId'
    OR operation.saved_method_id::text IS DISTINCT FROM p_evidence->>'savedMethodId'
    OR operation.collection_reference IS DISTINCT FROM p_evidence->>'collectionReference'
    OR operation.amount_kobo IS DISTINCT FROM (p_evidence->>'collectionAmountKobo')::bigint
    OR (operation.collection_provider_transaction_id IS NOT NULL AND
      operation.collection_provider_transaction_id IS DISTINCT FROM p_evidence->>'collectionTransactionId') THEN
    RAISE EXCEPTION 'prefunded reversal evidence scope refused' USING ERRCODE='42501';
  END IF;
  event_key:=p_evidence->>'eventId';
  INSERT INTO prefunded_card.collection_reversal_events(integration_id,event_id,operation_id,evidence,verified_by)
    VALUES(operation.integration_id,event_key,operation.id,p_evidence,session_user) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT existing FROM prefunded_card.collection_reversal_events
      WHERE integration_id=operation.integration_id AND event_id=event_key;
    IF existing.operation_id IS DISTINCT FROM operation.id OR existing.evidence IS DISTINCT FROM p_evidence THEN
      RAISE EXCEPTION 'prefunded reversal event conflict' USING ERRCODE='23505';
    END IF;
    outcome:='duplicate';
  END IF;
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  INSERT INTO prefunded_card.collection_reversal_obligations(operation_id,integration_id,merchant_id,customer_id,goal_id,
    treasury_binding_id,first_event_id,collection_amount_kobo,transfer_status_at_recording,transfer_transaction_id_at_recording,
    projection_status_at_recording,exposure,reserved_kobo_at_recording,consumed_kobo_at_recording)
    VALUES(operation.id,operation.integration_id,operation.merchant_id,operation.customer_id,operation.goal_id,
      operation.treasury_binding_id,event_key,operation.amount_kobo,operation.transfer_status,operation.transfer_provider_transaction_id,
      operation.projection_status,CASE operation.transfer_status WHEN 'not_started' THEN 'transfer_not_started'
        WHEN 'verified_success' THEN 'transfer_completed' WHEN 'verified_failed' THEN 'transfer_failed'
        ELSE 'transfer_in_flight' END,binding.reserved_kobo,binding.consumed_kobo) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT obligation FROM prefunded_card.collection_reversal_obligations WHERE operation_id=operation.id;
  IF operation.collection_status<>'reversed' THEN
    UPDATE prefunded_card.operations SET collection_status='reversed',
      collection_provider_transaction_id=p_evidence->>'collectionTransactionId',
      projection_status=CASE WHEN projection_status='applied' THEN 'applied' ELSE 'reconciliation_required' END
      WHERE id=operation.id;
  END IF;
  RETURN jsonb_build_object('operationId',operation.id,'eventId',event_key,'outcome',outcome,
    'obligation',obligation.obligation,'exposure',obligation.exposure);
END $$;
REVOKE ALL ON FUNCTION prefunded_card.lock_reversal_operation(uuid,text),prefunded_card.read_reversal_context(uuid,text),
  prefunded_card.record_collection_reversal(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- source: replay-enrollment.sql
CREATE FUNCTION prefunded_card.resolve_replay_enrollment(
  p_integration uuid,p_merchant uuid,p_treasury uuid,p_business text,
  p_database text,p_system text,p_hints jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury record;
DECLARE mapped record;
DECLARE operation record;
DECLARE bank boolean; reference_values text[]; matched uuid[];
DECLARE destination_wallet text; destination_customer text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_database IS DISTINCT FROM current_database()
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_business IS NULL OR octet_length(p_business) NOT BETWEEN 1 AND 512
    OR jsonb_typeof(p_hints) IS DISTINCT FROM 'object'
    OR octet_length(p_hints::text)>16384 THEN RETURN 'deferred'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_hints))<>8
    OR NOT p_hints ?& ARRAY['eventType','envelopeWalletId','envelopeCustomerId',
      'destinationWalletId','innerCustomerId','sourceWalletId','declaredDestinationWalletId','references']
    OR EXISTS(SELECT 1 FROM jsonb_each(p_hints) field
      WHERE field.key NOT IN ('references','sourceWalletId','declaredDestinationWalletId','destinationWalletId','innerCustomerId')
        AND (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512
          OR (field.value#>>'{}')~'[[:space:][:cntrl:]]'))
    OR EXISTS(SELECT 1 FROM jsonb_each(p_hints) field
      WHERE field.key IN ('sourceWalletId','declaredDestinationWalletId','destinationWalletId','innerCustomerId') AND field.value<>'null'::jsonb
        AND (jsonb_typeof(field.value)<>'string' OR octet_length(field.value#>>'{}') NOT BETWEEN 1 AND 512
          OR (field.value#>>'{}')~'[[:space:][:cntrl:]]'))
    OR jsonb_typeof(p_hints->'references') IS DISTINCT FROM 'array' THEN RETURN 'deferred'; END IF;
  IF jsonb_array_length(p_hints->'references') NOT BETWEEN 1 AND 16
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_hints->'references') reference_value
      WHERE jsonb_typeof(reference_value)<>'string' OR octet_length(reference_value#>>'{}') NOT BETWEEN 1 AND 512
        OR (reference_value#>>'{}')~'[[:space:][:cntrl:]]')
    OR p_hints->>'eventType' NOT IN ('bank-transfer.inflow.success','wallet-transfer.outflow.success')
    OR (p_hints->>'innerCustomerId' IS NOT NULL
      AND p_hints->>'innerCustomerId' IS DISTINCT FROM p_hints->>'envelopeCustomerId')
    OR (p_hints->>'declaredDestinationWalletId' IS NOT NULL AND p_hints->>'destinationWalletId' IS NOT NULL
      AND p_hints->>'declaredDestinationWalletId' IS DISTINCT FROM p_hints->>'destinationWalletId'
      AND (p_hints->>'eventType'<>'bank-transfer.inflow.success'
        OR p_hints->>'declaredDestinationWalletId' IS DISTINCT FROM p_hints->>'envelopeWalletId'))
    THEN RETURN 'deferred'; END IF;
  PERFORM prefunded_card.require_treasury_role('prefunded_treasury_ledger_worker');
  PERFORM id FROM piggyvest_staging.integrations WHERE id=p_integration AND enabled
    AND expected_provider_account_id=p_business FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND reader_login=session_user AND enabled
      AND business_id=p_business AND system_identifier=p_system AND currency='NGN' FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  SELECT binding.* INTO STRICT treasury FROM prefunded_card.treasury_bindings binding
    JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=binding.id
      AND identity.integration_id=binding.integration_id AND identity.merchant_id=binding.merchant_id
      AND identity.authorized_login=binding.authorized_login
      AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id
    WHERE binding.id=p_treasury AND binding.integration_id=p_integration AND binding.merchant_id=p_merchant
      AND binding.expected_business_id=p_business AND binding.authorized_login=session_user
      AND binding.enabled AND binding.currency='NGN' FOR SHARE OF binding,identity;
  bank:=p_hints->>'eventType'='bank-transfer.inflow.success';
  SELECT array_agg(value) INTO reference_values FROM jsonb_array_elements_text(p_hints->'references');
  SELECT coalesce(array_agg(candidate.id),'{}'::uuid[]) INTO matched FROM (
    SELECT entry.id FROM prefunded_card.operations entry WHERE entry.integration_id=p_integration
      AND (entry.transfer_reference=ANY(reference_values) OR entry.collection_reference=ANY(reference_values)
        OR entry.transfer_provider_transaction_id=ANY(reference_values)
        OR entry.collection_provider_transaction_id=ANY(reference_values)
        OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias
          WHERE alias.integration_id=p_integration AND alias.operation_id=entry.id
            AND alias.provider_transaction_id=ANY(reference_values))) LIMIT 2
  ) candidate;
  IF cardinality(matched)>1 THEN RETURN 'deferred'; END IF;
  IF cardinality(matched)=1 THEN
    SELECT * INTO STRICT operation FROM prefunded_card.operations WHERE id=matched[1] FOR SHARE;
    IF operation.merchant_id<>p_merchant OR operation.treasury_binding_id<>p_treasury THEN RETURN 'deferred'; END IF;
  ELSIF NOT bank THEN RETURN 'deferred';
  ELSIF (SELECT count(*) FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration
    AND merchant_id=p_merchant AND authorized_login=session_user)<>1 THEN RETURN 'deferred'; END IF;
  destination_wallet:=p_hints->>'destinationWalletId';
  IF bank THEN
    IF destination_wallet IS NULL OR p_hints->>'innerCustomerId' IS NULL THEN RETURN 'deferred'; END IF;
  ELSE
    IF p_hints->>'envelopeWalletId' IS DISTINCT FROM treasury.source_wallet_id
      OR (p_hints->>'sourceWalletId' IS NOT NULL AND p_hints->>'sourceWalletId' IS DISTINCT FROM treasury.source_wallet_id)
      OR (destination_wallet IS NOT NULL AND destination_wallet<>operation.destination_wallet_id)
      OR (p_hints->>'declaredDestinationWalletId' IS NOT NULL
        AND p_hints->>'declaredDestinationWalletId'<>operation.destination_wallet_id) THEN RETURN 'deferred'; END IF;
    destination_wallet:=operation.destination_wallet_id;
  END IF;
  IF destination_wallet=treasury.source_wallet_id THEN RETURN 'deferred'; END IF;
  SELECT mapping.* INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id
      AND goal.customer_id=mapping.customer_id AND goal.merchant_id=mapping.merchant_id
    WHERE mapping.integration_id=p_integration
      AND ((bank AND mapping.provider_wallet_id=ANY(ARRAY[destination_wallet,p_hints->>'envelopeWalletId']))
        OR (NOT bank AND mapping.provider_wallet_id=destination_wallet)) FOR SHARE OF mapping,customer,goal;
  IF mapped.merchant_id<>p_merchant THEN RETURN 'deferred'; END IF;
  destination_wallet:=mapped.provider_wallet_id;
  destination_customer:=mapped.provider_customer_id;
  IF bank THEN
    IF destination_customer IS DISTINCT FROM p_hints->>'envelopeCustomerId' THEN RETURN 'deferred'; END IF;
  END IF;
  IF cardinality(matched)=1 THEN
    IF operation.merchant_id<>p_merchant OR operation.treasury_binding_id<>p_treasury
      OR operation.goal_id<>mapped.goal_id OR operation.customer_id<>mapped.customer_id
      OR operation.destination_wallet_id<>destination_wallet
      OR operation.destination_customer_id<>destination_customer THEN RETURN 'deferred'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id=mapped.goal_id) THEN
    PERFORM route.goal_id FROM prefunded_card.credit_routes route
      JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=route.goal_id
        AND binding.integration_id=route.integration_id AND binding.merchant_id=route.merchant_id
        AND binding.customer_id=route.customer_id AND binding.enabled AND binding.authorized_login=session_user
      WHERE route.goal_id=mapped.goal_id AND route.integration_id=p_integration AND route.merchant_id=p_merchant
        AND route.customer_id=mapped.customer_id AND route.system_identifier=p_system FOR SHARE OF route,binding;
    IF FOUND THEN RETURN 'enrolled'; END IF;
    RETURN 'deferred';
  END IF;
  IF NOT bank OR cardinality(matched)>0
    OR p_hints->>'envelopeWalletId' IS DISTINCT FROM destination_wallet
    OR p_hints->>'destinationWalletId' IS DISTINCT FROM destination_wallet
    OR p_hints->>'sourceWalletId' IS NOT NULL
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=mapped.goal_id)
    OR EXISTS(SELECT 1 FROM prefunded_card.operations WHERE goal_id=mapped.goal_id)
    OR EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings other
      WHERE other.provider_wallet_id=destination_wallet AND other.integration_id<>p_integration)
    THEN RETURN 'deferred'; END IF;
  PERFORM goal.id FROM public.customer_savings_goals goal WHERE goal.id=mapped.goal_id
    AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN 'deferred'; END IF;
  IF (SELECT count(*) FROM public.piggyvest_plan_wallets WHERE wallet_id=destination_wallet)<>1 THEN RETURN 'deferred'; END IF;
  PERFORM wallet_id FROM public.piggyvest_plan_wallets WHERE wallet_id=destination_wallet
    AND piggyvest_customer_id=destination_customer AND customer_id::text=mapped.customer_id::text
    AND merchant_id::text=p_merchant::text FOR SHARE;
  IF FOUND THEN RETURN 'legacy'; END IF;
  RETURN 'deferred';
EXCEPTION WHEN OTHERS THEN RETURN 'deferred';
END $$;
REVOKE ALL ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMENT ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb) IS
  'Read-only routing from bounded untrusted receipt hints and immutable scope/mappings, not signature or monetary evidence. Enrolled only enables subsequent signature retrieval and independent evidence replay. Legacy needs exact private integration and public legacy wallet ownership without a canonical binding. Unknown or ambiguous state defers. Downstream writers must recheck enrollment; this lookup is not credit authority.';

-- source: executor-roles.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_treasury_ledger_worker') THEN
    CREATE ROLE prefunded_treasury_ledger_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_card_authorization_reader') THEN
    CREATE ROLE prefunded_card_authorization_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_card_authorization_provisioner') THEN
    CREATE ROLE prefunded_card_authorization_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_treasury_operator') THEN
    CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_authorizer') THEN
    CREATE ROLE prefunded_authorizer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    CREATE ROLE prefunded_evidence LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator;
GRANT prefunded_card_authorization_reader TO prefunded_treasury_operator;
GRANT prefunded_card_authorization_provisioner TO prefunded_authorizer;
REVOKE EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb), prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb), prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) FROM prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
REVOKE ALL ON SCHEMA prefunded_card FROM prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
GRANT USAGE ON SCHEMA prefunded_card TO prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;

GRANT EXECUTE ON FUNCTION prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb), prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid), prefunded_card.finish_dispatch(uuid,uuid,text), prefunded_card.read_operation(uuid,text), prefunded_card.project(uuid,text), prefunded_card.reserve(jsonb), prefunded_card.claim_collection(uuid,bigint), prefunded_card.record_collection(uuid,bigint,text,jsonb), prefunded_card.claim_transfer(uuid,bigint), prefunded_card.record_transfer(uuid,bigint,text,jsonb), prefunded_card.claim_reconciliation(uuid,integer), prefunded_card.complete_reconciliation(uuid,uuid,bigint,text,text,jsonb), prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), prefunded_card.read_transfer_evidence(uuid,text), prefunded_card.classify_provider_inflow(uuid,text,text), prefunded_card.apply_classified_inflow(uuid,text,text), prefunded_card.read_reversal_context(uuid,text), prefunded_card.record_collection_reversal(text,jsonb) TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION prefunded_card.authorization_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text), prefunded_card.provision_authorization(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) TO prefunded_authorizer;
GRANT EXECUTE ON FUNCTION prefunded_card.evidence_scope(uuid,text), prefunded_card.record_provider_evidence(uuid,text,jsonb), prefunded_card.evidence_destination_mapping(uuid,text,text) TO prefunded_evidence;
REVOKE EXECUTE ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  FROM PUBLIC, prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;
GRANT EXECUTE ON FUNCTION prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)
  TO prefunded_treasury_operator;

-- source: executor-identity.sql
CREATE FUNCTION prefunded_card.executor_system_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('database',current_database(),'login',session_user,
    'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))
$$;
REVOKE ALL ON FUNCTION prefunded_card.executor_system_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prefunded_card.executor_system_identity() TO prefunded_treasury_operator, prefunded_authorizer, prefunded_evidence;

-- source: checkout-storage.sql

CREATE TABLE prefunded_card.checkout_intents (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  deployment text COLLATE "C" NOT NULL CHECK (deployment = 'staging'),
  integration_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  treasury_binding_id uuid NOT NULL REFERENCES prefunded_card.treasury_bindings(id),
  business_id text COLLATE "C" NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  system_identifier text COLLATE "C" NOT NULL CHECK (system_identifier ~ '^[0-9]{1,20}$'),
  expires_at timestamptz NOT NULL CHECK (expires_at = '2026-09-29T15:59:10Z'::timestamptz),
  database_name name NOT NULL,
  authorized_login name NOT NULL,
  email text COLLATE "C" NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 1 AND 9007199254740991),
  currency text COLLATE "C" NOT NULL CHECK (currency = 'NGN'),
  idempotency_key uuid NOT NULL,
  idempotency_hash text COLLATE "C" NOT NULL UNIQUE CHECK (idempotency_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text COLLATE "C" NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  reference text COLLATE "C" NOT NULL UNIQUE,
  transfer_reference text COLLATE "C" NOT NULL UNIQUE,
  prepared_saved_method_id uuid NOT NULL UNIQUE,
  consent_version text COLLATE "C" NOT NULL CHECK (consent_version = 'prefunded-first-card-v1'),
  consent_one_time_charge boolean NOT NULL CHECK (consent_one_time_charge),
  consent_save_card boolean NOT NULL CHECK (consent_save_card),
  phase text COLLATE "C" NOT NULL DEFAULT 'reserved' CHECK (phase IN (
    'reserved', 'initializing', 'ready', 'pending', 'reconciliation_required', 'funding_pending', 'completed'
  )),
  initialization_fence bigint NOT NULL DEFAULT 0 CHECK (initialization_fence >= 0),
  initialization_token uuid,
  initialization_lease_expires_at timestamptz,
  session_reference text COLLATE "C",
  session_authorization_url text COLLATE "C",
  verified_collection jsonb,
  reconciliation_flagged_at timestamptz,
  reconciliation_flagged_by name,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (id = operation_id),
  CHECK (reference = 'pvb-first-' || id::text),
  CHECK (transfer_reference = 'pvbt-' || id::text),
  CHECK ((session_reference IS NULL) = (session_authorization_url IS NULL)),
  CHECK (session_reference IS NULL OR session_reference = reference),
  CHECK (session_authorization_url IS NULL OR session_authorization_url ~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$'),
  CHECK ((initialization_token IS NULL) = (initialization_lease_expires_at IS NULL)),
  FOREIGN KEY (operation_id) REFERENCES prefunded_card.operations(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX prefunded_first_card_one_unresolved_customer
  ON prefunded_card.checkout_intents(integration_id, merchant_id, customer_id)
  WHERE phase NOT IN ('funding_pending', 'completed');

ALTER TABLE prefunded_card.checkout_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY prefunded_first_card_checkout_intents_deny ON prefunded_card.checkout_intents
  USING (false) WITH CHECK (false);
REVOKE ALL ON prefunded_card.checkout_intents FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION prefunded_card.guard_first_card_checkout_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'first-card checkout intent immutable' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
    'phase', 'initialization_fence', 'initialization_token', 'initialization_lease_expires_at',
    'session_reference', 'session_authorization_url', 'verified_collection',
    'reconciliation_flagged_at', 'reconciliation_flagged_by'
  ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
    'phase', 'initialization_fence', 'initialization_token', 'initialization_lease_expires_at',
    'session_reference', 'session_authorization_url', 'verified_collection',
    'reconciliation_flagged_at', 'reconciliation_flagged_by'
  ]) THEN
    RAISE EXCEPTION 'first-card checkout audit immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.phase NOT IN ('initializing', 'ready', 'pending', 'reconciliation_required', 'funding_pending', 'completed')
    OR OLD.phase IN ('funding_pending', 'completed') AND NEW.phase <> OLD.phase
    OR OLD.phase = 'reserved' AND NEW.phase <> 'initializing'
    OR OLD.phase = 'initializing' AND NEW.phase NOT IN ('ready', 'pending', 'reconciliation_required', 'funding_pending')
    OR OLD.phase = 'ready' AND NEW.phase NOT IN ('pending', 'reconciliation_required', 'funding_pending')
    OR OLD.phase = 'pending' AND NEW.phase NOT IN ('reconciliation_required', 'funding_pending')
    OR OLD.phase = 'reconciliation_required' AND NEW.phase <> 'funding_pending'
    OR OLD.verified_collection IS NOT NULL AND NEW.verified_collection IS DISTINCT FROM OLD.verified_collection
    OR NEW.verified_collection IS NOT NULL AND NEW.phase NOT IN ('funding_pending', 'completed') THEN
    RAISE EXCEPTION 'first-card checkout transition denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_first_card_checkout_intent_guard
  BEFORE UPDATE OR DELETE ON prefunded_card.checkout_intents
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_first_card_checkout_intent();
CREATE TRIGGER prefunded_first_card_checkout_intent_no_truncate
  BEFORE TRUNCATE ON prefunded_card.checkout_intents
  FOR EACH STATEMENT EXECUTE FUNCTION prefunded_card.guard_first_card_checkout_intent();

CREATE FUNCTION prefunded_card.guard_first_card_collection_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM prefunded_card.checkout_intents intent WHERE intent.operation_id = OLD.id)
    AND OLD.collection_status = 'pending'
    AND NEW.collection_status IS DISTINCT FROM OLD.collection_status
    AND (
      NEW.collection_status <> 'verified_success'
      OR NOT pg_has_role(session_user, 'prefunded_authorizer', 'member')
    ) THEN
    RAISE EXCEPTION 'first-card collection requires independent verification' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM prefunded_card.checkout_intents intent WHERE intent.operation_id = OLD.id)
    AND NEW.collection_provider_transaction_id IS DISTINCT FROM OLD.collection_provider_transaction_id
    AND NEW.collection_status <> 'verified_success' THEN
    RAISE EXCEPTION 'first-card collection evidence denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prefunded_first_card_collection_transition_guard
  BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_first_card_collection_transition();

REVOKE ALL ON FUNCTION prefunded_card.guard_first_card_checkout_intent(),
  prefunded_card.guard_first_card_collection_transition() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE prefunded_card.checkout_intents IS
  'Private staging-only first-card checkout state. It reserves existing treasury capacity but cannot credit a wallet or savings goal.';

-- source: checkout-reserve.sql

CREATE FUNCTION prefunded_card.checkout_require_executor(p_login name) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user IS DISTINCT FROM p_login
    OR session_user IN ('anon', 'authenticated', 'service_role')
    OR NOT EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname = session_user
      AND NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
      AND NOT role.rolcreatedb AND NOT role.rolreplication) THEN
    RAISE EXCEPTION 'first-card checkout executor denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_scope(p_scope jsonb, p_mutation boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_scope IS NULL OR jsonb_typeof(p_scope) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_scope)) <> 7
    OR NOT p_scope ?& ARRAY['deployment','integrationId','merchantId','treasuryBindingId','businessId','systemIdentifier','expiresAt']
    OR jsonb_typeof(p_scope->'deployment') <> 'string'
    OR jsonb_typeof(p_scope->'integrationId') <> 'string'
    OR jsonb_typeof(p_scope->'merchantId') <> 'string'
    OR jsonb_typeof(p_scope->'treasuryBindingId') <> 'string'
    OR jsonb_typeof(p_scope->'businessId') <> 'string'
    OR jsonb_typeof(p_scope->'systemIdentifier') <> 'string'
    OR jsonb_typeof(p_scope->'expiresAt') <> 'string'
    OR p_scope->>'deployment' IS DISTINCT FROM 'staging'
    OR p_scope->>'systemIdentifier' !~ '^[0-9]{1,20}$'
    OR p_scope->>'systemIdentifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_scope->>'expiresAt' IS DISTINCT FROM '2026-09-29T15:59:10Z'
    OR p_scope->>'integrationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_scope->>'merchantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_scope->>'treasuryBindingId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR octet_length(btrim(coalesce(p_scope->>'businessId',''))) NOT BETWEEN 1 AND 512
    OR (p_mutation AND clock_timestamp() >= '2026-09-29T15:59:10Z'::timestamptz) THEN
    RAISE EXCEPTION 'first-card checkout scope denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_utc_iso(p_value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT to_char(p_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION prefunded_card.checkout_validate_selection(p_selection jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE field_name text;
BEGIN
  IF p_selection IS NULL OR jsonb_typeof(p_selection) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_selection)) <> 4
    OR NOT p_selection ?& ARRAY['intentId','customerId','actorId','goalId'] THEN
    RAISE EXCEPTION 'first-card checkout selection denied' USING ERRCODE = '42501';
  END IF;
  FOREACH field_name IN ARRAY ARRAY['intentId','customerId','actorId','goalId'] LOOP
    IF jsonb_typeof(p_selection->field_name) <> 'string'
      OR p_selection->>field_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'first-card checkout selection denied' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_request(p_request jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>6
    OR NOT p_request ?& ARRAY['customerId','actorId','goalId','amountKobo','idempotencyKey','consent']
    OR jsonb_typeof(p_request->'customerId')<>'string' OR jsonb_typeof(p_request->'actorId')<>'string'
    OR jsonb_typeof(p_request->'goalId')<>'string' OR jsonb_typeof(p_request->'idempotencyKey')<>'string'
    OR jsonb_typeof(p_request->'amountKobo')<>'number' OR jsonb_typeof(p_request->'consent')<>'object' THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
  IF p_request->>'customerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'actorId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'goalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'idempotencyKey' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'amountKobo' !~ '^[1-9][0-9]{0,15}$'
    OR p_request->'consent' IS DISTINCT FROM '{"version":"prefunded-first-card-v1","oneTimeCharge":true,"saveCard":true}'::jsonb THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
  IF (p_request->>'amountKobo')::numeric>9007199254740991 THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_intent_json(intent prefunded_card.checkout_intents) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('deployment',intent.deployment,'integrationId',intent.integration_id,
    'merchantId',intent.merchant_id,'treasuryBindingId',intent.treasury_binding_id,
    'businessId',intent.business_id,'systemIdentifier',intent.system_identifier,
    'expiresAt','2026-09-29T15:59:10Z','intentId',intent.id,'customerId',intent.customer_id,
    'actorId',intent.actor_id,'goalId',intent.goal_id,'amountKobo',intent.amount_kobo,
    'idempotencyKey',intent.idempotency_key,'consent',jsonb_build_object('version',intent.consent_version,
      'oneTimeCharge',intent.consent_one_time_charge,'saveCard',intent.consent_save_card),
    'email',intent.email,'currency',intent.currency,'reference',intent.reference,
    'requestFingerprint',intent.request_fingerprint);
$$;

CREATE FUNCTION prefunded_card.checkout_snapshot(intent prefunded_card.checkout_intents) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE phase_name text := intent.phase; operation prefunded_card.operations%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM prefunded_card.operations WHERE id = intent.operation_id;
  IF FOUND AND operation.projection_status = 'applied' THEN phase_name := 'completed'; END IF;
  RETURN jsonb_build_object('intent',prefunded_card.checkout_intent_json(intent),'phase',phase_name,
    'session',CASE WHEN phase_name = 'ready' THEN jsonb_build_object('reference',intent.session_reference,
      'authorizationUrl',intent.session_authorization_url) ELSE NULL END,
    'operationId',CASE WHEN phase_name IN ('funding_pending','completed') THEN intent.operation_id ELSE NULL END);
END $$;

CREATE FUNCTION prefunded_card.checkout_lock_intent(
  p_scope jsonb,p_selection jsonb,p_mutation boolean,p_require_operator_login boolean
) RETURNS prefunded_card.checkout_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_validate_scope(p_scope,p_mutation);
  PERFORM prefunded_card.checkout_validate_selection(p_selection);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR UPDATE;
  IF NOT FOUND OR binding.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=(p_selection->>'intentId')::uuid FOR UPDATE;
  IF NOT FOUND OR intent.integration_id IS DISTINCT FROM (p_scope->>'integrationId')::uuid
    OR intent.merchant_id IS DISTINCT FROM (p_scope->>'merchantId')::uuid
    OR intent.treasury_binding_id IS DISTINCT FROM (p_scope->>'treasuryBindingId')::uuid
    OR intent.business_id IS DISTINCT FROM p_scope->>'businessId' OR intent.system_identifier IS DISTINCT FROM p_scope->>'systemIdentifier'
    OR intent.customer_id IS DISTINCT FROM (p_selection->>'customerId')::uuid
    OR intent.actor_id IS DISTINCT FROM (p_selection->>'actorId')::uuid
    OR intent.goal_id IS DISTINCT FROM (p_selection->>'goalId')::uuid OR intent.database_name IS DISTINCT FROM current_database()
    OR intent.authorized_login IS DISTINCT FROM binding.authorized_login
    OR p_require_operator_login AND intent.authorized_login IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'first-card checkout intent denied' USING ERRCODE = '42501';
  END IF;
  PERFORM customer.id FROM public.customers customer WHERE customer.id=intent.customer_id
    AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout ownership denied' USING ERRCODE = '42501'; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,p_mutation);
  RETURN intent;
END $$;

CREATE FUNCTION prefunded_card.checkout_reserve(p_scope jsonb,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; intent prefunded_card.checkout_intents%ROWTYPE;
DECLARE operation prefunded_card.operations%ROWTYPE; goal public.customer_savings_goals%ROWTYPE; mapped record;
DECLARE request_idempotency_hash text; request_fingerprint text; email_value text; pending_kobo bigint; available_kobo bigint;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,false);
  PERFORM prefunded_card.checkout_validate_request(p_request);
  request_idempotency_hash:=encode(sha256(convert_to(jsonb_build_array(p_scope->>'integrationId',p_scope->>'merchantId',
    p_request->>'customerId',p_request->>'actorId',p_request->>'goalId',p_request->>'idempotencyKey')::text,'UTF8')),'hex');
  request_fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_scope,p_request)::text,'UTF8')),'hex');
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login IS DISTINCT FROM session_user OR binding.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO intent FROM prefunded_card.checkout_intents stored
    WHERE stored.idempotency_hash=request_idempotency_hash FOR UPDATE;
  IF FOUND THEN
    PERFORM customer.id FROM public.customers customer WHERE customer.id=intent.customer_id
      AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.actor_id FOR SHARE;
    IF NOT FOUND OR intent.request_fingerprint IS DISTINCT FROM request_fingerprint OR intent.authorized_login IS DISTINCT FROM session_user
      OR intent.database_name IS DISTINCT FROM current_database() THEN RAISE EXCEPTION 'first-card checkout replay conflict' USING ERRCODE='23505'; END IF;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF NOT binding.enabled OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE = '42501';
  END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=binding.id AND identity.integration_id=binding.integration_id
      AND identity.merchant_id=binding.merchant_id AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id AND identity.authorized_login=binding.authorized_login FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout treasury identity denied' USING ERRCODE='42501'; END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout integration denied' USING ERRCODE='42501'; END IF;
  SELECT lower(btrim(customer.email)) INTO email_value FROM public.customers customer WHERE customer.id=(p_request->>'customerId')::uuid
    AND customer.merchant_id=binding.merchant_id AND customer.user_id=(p_request->>'actorId')::uuid FOR SHARE;
  IF NOT FOUND OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR octet_length(email_value)>254 THEN
    RAISE EXCEPTION 'first-card checkout customer denied' USING ERRCODE='42501'; END IF;
  PERFORM method.id FROM public.customer_saved_payment_methods method WHERE method.customer_id=(p_request->>'customerId')::uuid
    AND method.provider='paystack' LIMIT 1 FOR SHARE;
  IF FOUND THEN RAISE EXCEPTION 'first-card checkout already has a card' USING ERRCODE='23505'; END IF;
  PERFORM prior.id FROM prefunded_card.checkout_intents prior WHERE prior.integration_id=binding.integration_id
    AND prior.merchant_id=binding.merchant_id AND prior.customer_id=(p_request->>'customerId')::uuid
    AND prior.phase<>'completed' LIMIT 1 FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'first-card checkout already unresolved' USING ERRCODE='23505'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=(p_request->>'goalId')::uuid AND merchant_id=binding.merchant_id
    AND customer_id=(p_request->>'customerId')::uuid AND goal_kind='legacy' AND status='active' AND completed_at IS NULL
    AND cancelled_at IS NULL AND spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout goal denied' USING ERRCODE='42501'; END IF;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id=binding.integration_id
    AND merchant_id=binding.merchant_id AND customer_id=(p_request->>'customerId')::uuid AND goal_id=goal.id FOR SHARE;
  operation.integration_id:=binding.integration_id; operation.merchant_id:=binding.merchant_id; operation.customer_id:=(p_request->>'customerId')::uuid;
  operation.goal_id:=goal.id; operation.treasury_binding_id:=binding.id; operation.destination_wallet_id:=mapped.provider_wallet_id;
  operation.destination_customer_id:=mapped.provider_customer_id; PERFORM prefunded_card.require_credit_route(operation,p_scope->>'systemIdentifier');
  SELECT coalesce(sum(amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations WHERE goal_id=goal.id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  available_kobo:=binding.verified_available_kobo-binding.reserved_kobo-binding.consumed_kobo;
  IF (goal.target_amount-goal.current_amount)*100-pending_kobo < (p_request->>'amountKobo')::bigint
    OR available_kobo < (p_request->>'amountKobo')::bigint THEN RAISE EXCEPTION 'first-card checkout capacity denied' USING ERRCODE='23514'; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  intent.id:=gen_random_uuid(); intent.operation_id:=intent.id; intent.prepared_saved_method_id:=gen_random_uuid();
  INSERT INTO prefunded_card.checkout_intents(id,operation_id,deployment,integration_id,merchant_id,customer_id,actor_id,goal_id,
    treasury_binding_id,business_id,system_identifier,expires_at,database_name,authorized_login,email,amount_kobo,currency,idempotency_key,
    idempotency_hash,request_fingerprint,reference,transfer_reference,prepared_saved_method_id,consent_version,consent_one_time_charge,consent_save_card)
  VALUES(intent.id,intent.id,'staging',binding.integration_id,binding.merchant_id,(p_request->>'customerId')::uuid,(p_request->>'actorId')::uuid,goal.id,
    binding.id,binding.expected_business_id,p_scope->>'systemIdentifier','2026-09-29T15:59:10Z',current_database(),session_user,email_value,
    (p_request->>'amountKobo')::bigint,'NGN',(p_request->>'idempotencyKey')::uuid,request_idempotency_hash,request_fingerprint,'pvb-first-'||intent.id,
    'pvbt-'||intent.id,intent.prepared_saved_method_id,'prefunded-first-card-v1',true,true);
  INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,request_fingerprint,idempotency_key,
    saved_method_id,amount_kobo,fee_allowance_kobo,currency,collection_reference,transfer_reference,destination_wallet_id,destination_customer_id,collection_status)
  VALUES(intent.id,binding.integration_id,binding.merchant_id,(p_request->>'customerId')::uuid,goal.id,binding.id,request_fingerprint,request_idempotency_hash,
    intent.prepared_saved_method_id,(p_request->>'amountKobo')::bigint,0,'NGN','pvb-first-'||intent.id,'pvbt-'||intent.id,
    mapped.provider_wallet_id,mapped.provider_customer_id,'pending');
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo+(p_request->>'amountKobo')::bigint WHERE id=binding.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_collection(p_operation uuid,p_fence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,false);
  IF p_fence IS NULL OR operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN
    RETURN jsonb_build_object('outcome','stale_or_reconciliation_required');
  END IF;
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN
    RETURN jsonb_build_object('outcome','stale_or_reconciliation_required');
  END IF;
  UPDATE prefunded_card.operations SET collection_status='dispatching',collection_fence=collection_fence+1,
    collection_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,
    'request',prefunded_card.request_for_operation(operation));
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_require_executor(name),prefunded_card.checkout_validate_scope(jsonb,boolean),
  prefunded_card.checkout_validate_selection(jsonb),prefunded_card.checkout_utc_iso(timestamptz),prefunded_card.checkout_intent_json(prefunded_card.checkout_intents),
  prefunded_card.checkout_validate_request(jsonb),prefunded_card.checkout_snapshot(prefunded_card.checkout_intents),prefunded_card.checkout_lock_intent(jsonb,jsonb,boolean,boolean),
  prefunded_card.checkout_reserve(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- source: checkout-initialization.sql

CREATE FUNCTION prefunded_card.checkout_validate_initialization_claim(
  intent prefunded_card.checkout_intents,p_claim jsonb,p_require_live_lease boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_claim IS NULL OR jsonb_typeof(p_claim)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_claim))<>5
    OR NOT p_claim ?& ARRAY['outcome','intent','token','fence','leaseExpiresAt']
    OR jsonb_typeof(p_claim->'outcome')<>'string' OR jsonb_typeof(p_claim->'intent')<>'object'
    OR jsonb_typeof(p_claim->'token')<>'string' OR jsonb_typeof(p_claim->'fence')<>'number'
    OR jsonb_typeof(p_claim->'leaseExpiresAt')<>'string' THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
  IF p_claim->>'outcome' IS DISTINCT FROM 'claimed'
    OR p_claim->'intent' IS DISTINCT FROM prefunded_card.checkout_intent_json(intent)
    OR p_claim->>'token' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_claim->>'fence' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
  IF intent.initialization_token IS DISTINCT FROM (p_claim->>'token')::uuid
    OR intent.initialization_fence IS DISTINCT FROM (p_claim->>'fence')::bigint
    OR p_claim->>'leaseExpiresAt' IS DISTINCT FROM prefunded_card.checkout_utc_iso(intent.initialization_lease_expires_at)
    OR (p_require_live_lease AND (intent.initialization_lease_expires_at IS NULL
      OR intent.initialization_lease_expires_at<=clock_timestamp())) THEN
    RAISE EXCEPTION 'first-card checkout initialization claim denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_read(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,false,true);
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_claim_initialization(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE; token uuid;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=intent.treasury_binding_id FOR SHARE;
  IF NOT FOUND OR binding.integration_id IS DISTINCT FROM intent.integration_id
    OR binding.merchant_id IS DISTINCT FROM intent.merchant_id
    OR binding.expected_business_id IS DISTINCT FROM intent.business_id
    OR binding.authorized_login IS DISTINCT FROM intent.authorized_login
    OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RAISE EXCEPTION 'first-card checkout initialization denied' USING ERRCODE='42501';
  END IF;
  IF intent.phase<>'reserved' THEN
    RETURN jsonb_build_object('outcome','existing','snapshot',prefunded_card.checkout_snapshot(intent));
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  token:=gen_random_uuid();
  UPDATE prefunded_card.checkout_intents SET phase='initializing',initialization_fence=initialization_fence+1,
    initialization_token=token,initialization_lease_expires_at=least(
      clock_timestamp()+interval '120 seconds','2026-09-29T15:59:10Z'::timestamptz
    ) WHERE id=intent.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN jsonb_build_object('outcome','claimed','intent',prefunded_card.checkout_intent_json(intent),
    'token',token,'fence',intent.initialization_fence,
    'leaseExpiresAt',prefunded_card.checkout_utc_iso(intent.initialization_lease_expires_at));
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_session(
  intent prefunded_card.checkout_intents,p_session jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF intent.phase IS DISTINCT FROM 'initializing' OR p_session IS NULL OR jsonb_typeof(p_session)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_session))<>2 OR NOT p_session ?& ARRAY['reference','authorizationUrl']
    OR jsonb_typeof(p_session->'reference')<>'string' OR jsonb_typeof(p_session->'authorizationUrl')<>'string'
    OR p_session->>'reference' IS DISTINCT FROM intent.reference
    OR octet_length(p_session->>'authorizationUrl')>512
    OR p_session->>'authorizationUrl' !~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'first-card checkout session denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_complete_initialization(
  p_scope jsonb,p_selection jsonb,p_claim jsonb,p_session jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  PERFORM prefunded_card.checkout_validate_initialization_claim(intent,p_claim,true);
  PERFORM prefunded_card.checkout_validate_session(intent,p_session);
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  UPDATE prefunded_card.checkout_intents SET phase='ready',session_reference=intent.reference,
    session_authorization_url=p_session->>'authorizationUrl',initialization_token=NULL,initialization_lease_expires_at=NULL
    WHERE id=intent.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_mark_initialization_uncertain(
  p_scope jsonb,p_selection jsonb,p_claim jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,false,false);
  PERFORM prefunded_card.checkout_validate_initialization_claim(intent,p_claim,false);
  IF intent.phase<>'initializing' THEN
    RAISE EXCEPTION 'first-card checkout uncertainty denied' USING ERRCODE='42501';
  END IF;
  UPDATE prefunded_card.checkout_intents SET phase='pending',initialization_token=NULL,
    initialization_lease_expires_at=NULL WHERE id=intent.id;
  RETURN 'true'::jsonb;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_validate_initialization_claim(prefunded_card.checkout_intents,jsonb,boolean),
  prefunded_card.checkout_validate_session(prefunded_card.checkout_intents,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb),prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: checkout-promotion.sql

CREATE FUNCTION prefunded_card.checkout_validate_collection(
  intent prefunded_card.checkout_intents,p_collection jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE collection_authorization jsonb;
BEGIN
  IF p_collection IS NULL OR jsonb_typeof(p_collection)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_collection))<>7
    OR NOT p_collection ?& ARRAY['intentId','reference','providerTransactionId','amountKobo','currency','domain','authorization']
    OR jsonb_typeof(p_collection->'intentId')<>'string' OR jsonb_typeof(p_collection->'reference')<>'string'
    OR jsonb_typeof(p_collection->'providerTransactionId')<>'string' OR jsonb_typeof(p_collection->'amountKobo')<>'number'
    OR jsonb_typeof(p_collection->'currency')<>'string' OR jsonb_typeof(p_collection->'domain')<>'string'
    OR jsonb_typeof(p_collection->'authorization')<>'object' THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  IF p_collection->>'intentId' IS DISTINCT FROM intent.id::text
    OR p_collection->>'reference' IS DISTINCT FROM intent.reference
    OR p_collection->>'currency' IS DISTINCT FROM 'NGN' OR p_collection->>'domain' IS DISTINCT FROM 'test'
    OR p_collection->>'providerTransactionId' !~ '^[1-9][0-9]{0,19}$'
    OR p_collection->>'amountKobo' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  IF (p_collection->>'providerTransactionId')::numeric>18446744073709551615
    OR (p_collection->>'amountKobo')::bigint IS DISTINCT FROM intent.amount_kobo THEN
    RAISE EXCEPTION 'first-card checkout collection denied' USING ERRCODE='42501';
  END IF;
  collection_authorization:=p_collection->'authorization';
  IF jsonb_typeof(collection_authorization)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(collection_authorization))<>9
    OR NOT collection_authorization ?& ARRAY['authorizationCode','signature','customerCode','email','reusable','brand','last4','expiryMonth','expiryYear']
    OR jsonb_typeof(collection_authorization->'authorizationCode')<>'string' OR jsonb_typeof(collection_authorization->'signature')<>'string'
    OR jsonb_typeof(collection_authorization->'customerCode')<>'string' OR jsonb_typeof(collection_authorization->'email')<>'string'
    OR jsonb_typeof(collection_authorization->'reusable')<>'boolean' OR jsonb_typeof(collection_authorization->'brand')<>'string'
    OR jsonb_typeof(collection_authorization->'last4')<>'string' OR jsonb_typeof(collection_authorization->'expiryMonth')<>'string'
    OR jsonb_typeof(collection_authorization->'expiryYear')<>'string' THEN
    RAISE EXCEPTION 'first-card checkout authorization denied' USING ERRCODE='42501';
  END IF;
  IF collection_authorization->>'authorizationCode' !~ '^AUTH_[A-Za-z0-9_]+$'
    OR octet_length(collection_authorization->>'authorizationCode') NOT BETWEEN 6 AND 512
    OR octet_length(collection_authorization->>'signature') NOT BETWEEN 1 AND 512 OR collection_authorization->>'signature' ~ '[[:space:][:cntrl:]]'
    OR collection_authorization->>'customerCode' !~ '^CUS_[A-Za-z0-9_]+$' OR octet_length(collection_authorization->>'customerCode')>512
    OR collection_authorization->>'email' IS DISTINCT FROM intent.email OR collection_authorization->'reusable' IS DISTINCT FROM 'true'::jsonb
    OR octet_length(btrim(coalesce(collection_authorization->>'brand',''))) NOT BETWEEN 1 AND 64
    OR collection_authorization->>'brand' ~ '[[:cntrl:]]' OR collection_authorization->>'last4' !~ '^[0-9]{4}$'
    OR collection_authorization->>'expiryMonth' !~ '^(0?[1-9]|1[0-2])$' OR collection_authorization->>'expiryYear' !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'first-card checkout authorization denied' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_promote_collection(
  p_scope jsonb,p_selection jsonb,p_collection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; operation prefunded_card.operations%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; collection_authorization jsonb;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  PERFORM prefunded_card.checkout_validate_collection(intent,p_collection);
  SELECT * INTO operation FROM prefunded_card.operations WHERE id=intent.operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout operation denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=intent.treasury_binding_id FOR SHARE;
  IF NOT FOUND OR operation.integration_id IS DISTINCT FROM intent.integration_id
    OR operation.merchant_id IS DISTINCT FROM intent.merchant_id
    OR operation.customer_id IS DISTINCT FROM intent.customer_id OR operation.goal_id IS DISTINCT FROM intent.goal_id
    OR operation.treasury_binding_id IS DISTINCT FROM intent.treasury_binding_id
    OR operation.saved_method_id IS DISTINCT FROM intent.prepared_saved_method_id
    OR operation.amount_kobo IS DISTINCT FROM intent.amount_kobo OR operation.currency IS DISTINCT FROM intent.currency
    OR operation.collection_reference IS DISTINCT FROM intent.reference OR operation.transfer_reference IS DISTINCT FROM intent.transfer_reference
    OR binding.integration_id IS DISTINCT FROM intent.integration_id OR binding.merchant_id IS DISTINCT FROM intent.merchant_id
    OR binding.expected_business_id IS DISTINCT FROM intent.business_id OR binding.authorized_login IS DISTINCT FROM intent.authorized_login THEN
    RAISE EXCEPTION 'first-card checkout operation denied' USING ERRCODE='42501';
  END IF;
  IF intent.phase IN ('funding_pending','completed') THEN
    IF intent.verified_collection IS DISTINCT FROM p_collection THEN
      RAISE EXCEPTION 'first-card checkout collection conflict' USING ERRCODE='23505';
    END IF;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  IF intent.phase NOT IN ('initializing','ready','pending','reconciliation_required') OR operation.collection_status<>'pending'
    OR operation.collection_provider_transaction_id IS NOT NULL OR operation.transfer_status<>'not_started' THEN
    RAISE EXCEPTION 'first-card checkout promotion unavailable' USING ERRCODE='42501';
  END IF;
  collection_authorization:=p_collection->'authorization';
  IF EXISTS (SELECT 1 FROM public.customer_saved_payment_methods method WHERE method.customer_id=intent.customer_id
    AND method.provider='paystack' AND method.authorization_signature=collection_authorization->>'signature' FOR KEY SHARE) THEN
    PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
    UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',reconciliation_flagged_at=clock_timestamp(),
      reconciliation_flagged_by=session_user WHERE id=intent.id;
    SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  BEGIN
    INSERT INTO public.customer_saved_payment_methods(id,merchant_id,customer_id,provider,provider_customer_email,
      authorization_code,authorization_signature,authorization_data,brand,last4,exp_month,exp_year,reusable,is_default,is_active)
    VALUES(intent.prepared_saved_method_id,intent.merchant_id,intent.customer_id,'paystack',intent.email,
      collection_authorization->>'authorizationCode',collection_authorization->>'signature',jsonb_build_object('authorization_code',collection_authorization->>'authorizationCode',
        'signature',collection_authorization->>'signature','channel','card','reusable',true),collection_authorization->>'brand',collection_authorization->>'last4',
      collection_authorization->>'expiryMonth',collection_authorization->>'expiryYear',true,false,true);
    INSERT INTO prefunded_card.authorization_bindings(treasury_binding_id,saved_method_id,integration_id,merchant_id,customer_id,
      transaction_id,provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,paystack_customer_code,
      domain,reusable,authorized_login,system_identifier,database_name,provisioned_by)
    VALUES(intent.treasury_binding_id,intent.prepared_saved_method_id,intent.integration_id,intent.merchant_id,intent.customer_id,
      intent.id,p_collection->>'providerTransactionId',intent.reference,intent.email,collection_authorization->>'authorizationCode',
      collection_authorization->>'signature',collection_authorization->>'customerCode','test',true,intent.authorized_login,intent.system_identifier,
      intent.database_name,session_user);
    UPDATE prefunded_card.operations SET collection_status='verified_success',
      collection_provider_transaction_id=p_collection->>'providerTransactionId' WHERE id=operation.id;
    UPDATE prefunded_card.checkout_intents SET phase='funding_pending',verified_collection=p_collection,
      initialization_token=NULL,initialization_lease_expires_at=NULL WHERE id=intent.id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
    UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',reconciliation_flagged_at=clock_timestamp(),
      reconciliation_flagged_by=session_user WHERE id=intent.id;
  END;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE FUNCTION prefunded_card.checkout_flag_reconciliation(p_scope jsonb,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  intent:=prefunded_card.checkout_lock_intent(p_scope,p_selection,true,false);
  IF intent.phase IN ('funding_pending','completed','reconciliation_required') THEN RETURN 'true'::jsonb; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',initialization_token=NULL,
    initialization_lease_expires_at=NULL,reconciliation_flagged_at=clock_timestamp(),reconciliation_flagged_by=session_user
    WHERE id=intent.id;
  RETURN 'true'::jsonb;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_validate_collection(prefunded_card.checkout_intents,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- source: checkout-capability.sql
CREATE FUNCTION prefunded_card.checkout_capability(
  p_scope jsonb,p_customer uuid,p_actor uuid,p_goal uuid,p_maximum_amount_kobo bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE;
DECLARE pending_kobo bigint; available_float_kobo bigint; remaining_goal_kobo bigint;
DECLARE maximum_kobo bigint := 0; email_value text;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF p_customer IS NULL OR p_actor IS NULL OR p_goal IS NULL
    OR p_maximum_amount_kobo IS NULL OR p_maximum_amount_kobo < 0
    OR p_maximum_amount_kobo > 9007199254740991 THEN
    RAISE EXCEPTION 'first-card checkout capability denied' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR SHARE;
  IF NOT FOUND OR binding.authorized_login IS DISTINCT FROM session_user OR binding.currency IS DISTINCT FROM 'NGN'
    OR NOT binding.enabled OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=binding.id AND identity.integration_id=binding.integration_id
      AND identity.merchant_id=binding.merchant_id AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id AND identity.authorized_login=binding.authorized_login FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT lower(btrim(customer.email)) INTO email_value FROM public.customers customer WHERE customer.id=p_customer
    AND customer.merchant_id=binding.merchant_id AND customer.user_id=p_actor FOR SHARE;
  IF NOT FOUND OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR octet_length(email_value)>254 THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=binding.merchant_id
    AND customer_id=p_customer AND goal_kind='legacy' AND status='active' AND completed_at IS NULL
    AND cancelled_at IS NULL AND spent_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM mapping.provider_wallet_id FROM piggyvest_staging.wallet_goal_mappings mapping
    WHERE mapping.integration_id=binding.integration_id AND mapping.merchant_id=binding.merchant_id
      AND mapping.customer_id=p_customer AND mapping.goal_id=goal.id FOR SHARE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.customer_saved_payment_methods method
    WHERE method.customer_id=p_customer AND method.provider='paystack'
      AND method.is_active AND method.reusable
  ) OR EXISTS (
    SELECT 1 FROM prefunded_card.checkout_intents intent
    WHERE intent.integration_id=binding.integration_id AND intent.merchant_id=binding.merchant_id
      AND intent.customer_id=p_customer
      AND intent.phase NOT IN ('funding_pending','completed')
  ) THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT coalesce(sum(operation.amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations operation
    WHERE operation.goal_id=goal.id AND operation.collection_status NOT IN ('verified_failed','reversed')
      AND operation.projection_status<>'applied';
  remaining_goal_kobo:=greatest((goal.target_amount-goal.current_amount)*100-pending_kobo,0);
  available_float_kobo:=greatest(binding.verified_available_kobo-binding.reserved_kobo-binding.consumed_kobo,0);
  maximum_kobo:=least(p_maximum_amount_kobo,remaining_goal_kobo,available_float_kobo);
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  RETURN jsonb_build_object('goalId',p_goal,'enabled',maximum_kobo>0,
    'maximumAmountKobo',maximum_kobo,'currency','NGN');
END $$;

-- source: checkout-roles.sql

REVOKE ALL ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
  prefunded_card.checkout_reserve(jsonb,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb),
  prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
  prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    REVOKE ALL ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
      prefunded_card.checkout_reserve(jsonb,jsonb),
      prefunded_card.checkout_read(jsonb,jsonb),
      prefunded_card.checkout_claim_initialization(jsonb,jsonb),
      prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
      prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
      prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
      prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)
      FROM prefunded_evidence;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint),
  prefunded_card.checkout_reserve(jsonb,jsonb),
  prefunded_card.checkout_read(jsonb,jsonb) TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION prefunded_card.checkout_claim_initialization(jsonb,jsonb),
  prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb),
  prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb),
  prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb),
  prefunded_card.checkout_flag_reconciliation(jsonb,jsonb) TO prefunded_authorizer;

REVOKE ALL ON prefunded_card.checkout_intents FROM prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prefunded_evidence') THEN
    REVOKE ALL ON prefunded_card.checkout_intents FROM prefunded_evidence;
  END IF;
END $$;

-- source: checkout-recovery.sql

CREATE FUNCTION prefunded_card.checkout_recovery_candidates(
  p_scope jsonb,p_after jsonb,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; result jsonb;
DECLARE cursor_created_at timestamptz; cursor_intent_id uuid; cursor_value jsonb;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_authorizer');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'first-card checkout recovery limit denied' USING ERRCODE='22023';
  END IF;
  IF p_after IS NOT NULL AND p_after<>'null'::jsonb THEN
    IF jsonb_typeof(p_after)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_after))<>2
      OR NOT p_after ?& ARRAY['createdAt','intentId']
      OR jsonb_typeof(p_after->'createdAt')<>'string' OR jsonb_typeof(p_after->'intentId')<>'string'
      OR p_after->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      OR p_after->>'intentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'first-card checkout recovery cursor denied' USING ERRCODE='22023';
    END IF;
    cursor_created_at:=(p_after->>'createdAt')::timestamptz;
    cursor_intent_id:=(p_after->>'intentId')::uuid;
    IF prefunded_card.checkout_utc_iso(cursor_created_at) IS DISTINCT FROM p_after->>'createdAt' THEN
      RAISE EXCEPTION 'first-card checkout recovery cursor denied' USING ERRCODE='22023';
    END IF;
  END IF;

  result:=jsonb_build_object('candidates','[]'::jsonb,'nextCursor',p_after);
  FOR intent IN
    SELECT stored.*
    FROM prefunded_card.checkout_intents stored
    JOIN prefunded_card.treasury_bindings binding ON binding.id=stored.treasury_binding_id
    WHERE stored.deployment='staging'
      AND stored.integration_id=(p_scope->>'integrationId')::uuid
      AND stored.merchant_id=(p_scope->>'merchantId')::uuid
      AND stored.treasury_binding_id=(p_scope->>'treasuryBindingId')::uuid
      AND stored.business_id=p_scope->>'businessId'
      AND stored.system_identifier=p_scope->>'systemIdentifier'
      AND stored.expires_at='2026-09-29T15:59:10Z'::timestamptz
      AND stored.database_name=current_database()
      AND stored.phase IN ('initializing','ready','pending')
      AND binding.integration_id=stored.integration_id
      AND binding.merchant_id=stored.merchant_id
      AND binding.expected_business_id=stored.business_id
      AND binding.authorized_login=stored.authorized_login
      AND binding.currency='NGN'
    ORDER BY CASE
        WHEN cursor_created_at IS NULL OR (date_trunc('milliseconds',stored.created_at),stored.id)>(cursor_created_at,cursor_intent_id) THEN 0
        ELSE 1
      END,
      date_trunc('milliseconds',stored.created_at),stored.id
    LIMIT p_limit
  LOOP
    cursor_value:=jsonb_build_object(
      'createdAt',prefunded_card.checkout_utc_iso(intent.created_at),
      'intentId',intent.id
    );
    result:=jsonb_set(
      result,
      '{candidates}',
      (result->'candidates') || jsonb_build_array(jsonb_build_object(
        'cursor',cursor_value,
        'intent',prefunded_card.checkout_intent_json(intent)
      ))
    );
    result:=jsonb_set(result,'{nextCursor}',cursor_value);
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
  FROM PUBLIC,anon,authenticated,service_role,prefunded_treasury_operator,prefunded_authorizer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prefunded_evidence') THEN
    REVOKE ALL ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
      FROM prefunded_evidence;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)
  TO prefunded_authorizer;

COMMENT ON FUNCTION prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer) IS
  'Authorizer-only bounded circular read of unresolved staging first-card intents; it performs no provider, reservation, transfer, or credit action.';


-- foundation finalize executor roles

ALTER ROLE prefunded_treasury_operator NOLOGIN;

ALTER ROLE prefunded_authorizer NOLOGIN;

ALTER ROLE prefunded_evidence NOLOGIN;

-- foundation postguard
DO $foundation_postguard$
BEGIN
  IF clock_timestamp() >= '2026-09-29T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'foundation_expired:2026-09-29T15:59:10Z';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'])
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'foundation_conflict:executor_role_state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles AS role
    CROSS JOIN pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE role.rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'])
      AND namespace.nspname = 'prefunded_card' AND relation.relkind IN ('r', 'p')
      AND (has_table_privilege(role.oid, relation.oid, 'SELECT') OR has_table_privilege(role.oid, relation.oid, 'INSERT')
        OR has_table_privilege(role.oid, relation.oid, 'UPDATE') OR has_table_privilege(role.oid, relation.oid, 'DELETE'))
  ) THEN
    RAISE EXCEPTION 'foundation_conflict:executor_table_privilege';
  END IF;
  IF (SELECT count(*) FROM prefunded_card.operations) <> 0
    OR (SELECT count(*) FROM prefunded_card.treasury_bindings) <> 0
    OR (SELECT count(*) FROM prefunded_card.checkout_intents) <> 0 THEN
    RAISE EXCEPTION 'foundation_conflict:inactive_rows';
  END IF;
END
$foundation_postguard$;

COMMIT;
