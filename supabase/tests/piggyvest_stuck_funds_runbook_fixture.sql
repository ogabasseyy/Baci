-- Fixture schema for run_piggyvest_stuck_funds_runbook.py (synthetic test database only).
-- Column definitions follow the real migration DDL for every column the runbook reads or the
-- real functions write; unrelated tables and helpers are reduced to stubs. The bodies of
-- reverse_vtu_wallet_payment, reverse_wallet_redemption and cancel_order_as_merchant are NOT
-- copied here: the runner loads their latest definitions from supabase/migrations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid, slug text UNIQUE);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), user_id uuid);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid, order_number text NOT NULL,
  shipping_status text DEFAULT 'pending' NOT NULL, payment_status text DEFAULT 'unpaid' NOT NULL,
  total numeric(10,2) NOT NULL, currency text DEFAULT 'NGN', payment_method text,
  wallet_amount_used numeric(12,2) DEFAULT 0.00, amount_paid numeric(10,2) DEFAULT 0,
  cancelled_at timestamptz, cancellation_reason text, cancelled_by text,
  cancellation_refund_mode text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.order_wallet_funding_intents (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, order_id uuid NOT NULL,
  expected_amount numeric(12,2) NOT NULL, funded_amount numeric(12,2) NOT NULL DEFAULT 0,
  debited_amount numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.order_cancellation_side_effects (
  order_id uuid NOT NULL, merchant_id uuid NOT NULL, step text NOT NULL, status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0, PRIMARY KEY (order_id, step));
CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "merchant_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "currency" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "gateway" "text" DEFAULT 'korapay'::"text",
    "gateway_reference" "text",
    "gateway_response" "jsonb",
    "description" "text",
    "metadata" "jsonb",
    "platform_fee" numeric(15,2) DEFAULT 0.00,
    "merchant_amount" numeric(15,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "transactions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text", 'refunded'::"text", 'refund_pending'::"text"]))),
    CONSTRAINT "transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['payment'::"text", 'payout'::"text", 'refund'::"text", 'fee'::"text", 'conversion'::"text"])))
);
CREATE TABLE IF NOT EXISTS "public"."customer_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "merchant_id" "uuid" NOT NULL,
    "available_balance" numeric(12,2) DEFAULT 0.00,
    "total_earned" numeric(12,2) DEFAULT 0.00,
    "total_redeemed" numeric(12,2) DEFAULT 0.00,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
CREATE TABLE IF NOT EXISTS "public"."customer_wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "merchant_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "source_type" "text",
    "source_id" "uuid",
    "status" "text" DEFAULT 'completed'::"text",
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "customer_wallet_transactions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'expired'::"text"]))),
    CONSTRAINT "customer_wallet_transactions_type_check" CHECK (("type" = ANY (ARRAY['cashback'::"text", 'redemption'::"text", 'bonus'::"text", 'adjustment'::"text", 'expiry'::"text"])))
);
CREATE TABLE IF NOT EXISTS "public"."vtu_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "merchant_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "order_id" "uuid",
    "type" "text" NOT NULL,
    "network_provider" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "request_reference" "text" NOT NULL,
    "transaction_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "source" "text" DEFAULT 'checkout'::"text" NOT NULL,
    "platform_commission" numeric(10,2) DEFAULT 0,
    "merchant_commission" numeric(10,2) DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "customer_cashback" numeric(10,2) DEFAULT 0,
    "biller_name" "text",
    "biller_item_code" "text",
    "customer_identifier" "text",
    "customer_name" "text",
    CONSTRAINT "vtu_transactions_source_check" CHECK (("source" = ANY (ARRAY['checkout'::"text", 'loyalty_reward'::"text", 'direct'::"text", 'gift'::"text", 'storefront_modal'::"text"]))),
    CONSTRAINT "vtu_transactions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'successful'::"text", 'failed'::"text"]))),
    CONSTRAINT "vtu_transactions_type_check" CHECK (("type" = ANY (ARRAY['airtime'::"text", 'data'::"text", 'electricity'::"text", 'cable_tv'::"text", 'betting'::"text"])))
);
ALTER TABLE public.customer_wallets ADD PRIMARY KEY (id), ADD UNIQUE (customer_id);
ALTER TABLE public.vtu_transactions ADD PRIMARY KEY (id);
ALTER TABLE public.customer_wallet_transactions DROP CONSTRAINT customer_wallet_transactions_type_check;
ALTER TABLE public.customer_wallet_transactions ADD CONSTRAINT customer_wallet_transactions_type_check
  CHECK (type = ANY (ARRAY['cashback','redemption','bonus','adjustment','expiry','credit','debit','refund']));
CREATE OR REPLACE FUNCTION "public"."update_vtu_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER "update_vtu_transactions_updated_at" BEFORE UPDATE ON "public"."vtu_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_vtu_updated_at"();
ALTER TABLE public.vtu_transactions
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

-- The terminal-time trigger function and its trigger are loaded verbatim from supabase/migrations by the runner.
-- Stubs for dependencies of the real cancel_order_as_merchant that the checks do not exercise.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$ SELECT pg_catalog.gen_random_uuid() $$;
CREATE FUNCTION public.check_staff_permission(uuid, uuid, text, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION private.restock_order_items(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION private.release_order_inventory_units(uuid, uuid, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.reverse_savings_redemption_for_order(uuid, uuid, uuid, text) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.normalized_gateway_name_v1(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper($1) $$;
CREATE TABLE public.order_payment_accounts (order_id uuid, expires_at timestamptz);
CREATE TABLE public.reconciliation_review (id uuid DEFAULT gen_random_uuid(), txn_id uuid, order_id uuid,
  issue_type text, resolved_at timestamptz, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.order_audit_events (merchant_id uuid, order_id uuid, actor_user_id uuid, action text,
  change_category text, changed_fields text[], before_snapshot jsonb, after_snapshot jsonb, metadata jsonb);
ALTER TABLE public.order_cancellation_side_effects ADD COLUMN claim_token uuid;
