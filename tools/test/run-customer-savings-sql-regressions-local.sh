#!/usr/bin/env bash
set -euo pipefail

postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/baci-customer-savings.XXXXXX)"
socket_dir="$temp_dir/socket"
port="${POSTGRES_PORT:-55439}"

cleanup() {
  if [[ -f "$temp_dir/data/postmaster.pid" ]]; then
    "$postgres_bin/pg_ctl" -D "$temp_dir/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  find "$temp_dir" -depth -delete
}
trap cleanup EXIT INT TERM

mkdir "$socket_dir"
"$postgres_bin/initdb" -D "$temp_dir/data" -A trust -U harness_admin --no-locale >/dev/null
"$postgres_bin/pg_ctl" -D "$temp_dir/data" \
  -o "-k '$socket_dir' -h '' -p $port" -l "$temp_dir/postgres.log" start >/dev/null
psql=("$postgres_bin/psql" -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$port" -U harness_admin -d postgres)

"${psql[@]}" <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''request.jwt.claim.role'', true), '''')';

CREATE TABLE public.merchants (
  id uuid PRIMARY KEY, email text NOT NULL, business_name text NOT NULL, slug text NOT NULL
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, user_id uuid, email text NOT NULL, first_name text NOT NULL
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, name text NOT NULL, price numeric(12,2),
  status text NOT NULL DEFAULT 'active', images jsonb, condition text
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY, product_id uuid NOT NULL, merchant_id uuid NOT NULL, attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_override numeric(12,2), condition text, images jsonb, primary_image text, sku text,
  is_inventory_anchor boolean NOT NULL DEFAULT false
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, order_number text NOT NULL, total numeric(12,2) NOT NULL
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, product_id uuid NOT NULL,
  variant_id uuid, name text NOT NULL, price numeric(12,2) NOT NULL, quantity integer NOT NULL
);
CREATE TABLE public.customer_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  available_balance numeric(12,2) NOT NULL DEFAULT 0, pending_balance numeric(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  product_id uuid NOT NULL, variant_id uuid, title text NOT NULL, product_snapshot jsonb, target_amount numeric(12,2) NOT NULL,
  current_amount numeric(12,2) NOT NULL DEFAULT 0, initial_contribution_amount numeric(12,2) NOT NULL DEFAULT 0,
  contribution_amount numeric(12,2) NOT NULL, contribution_frequency text NOT NULL, preferred_debit_time time,
  start_date date NOT NULL, maturity_date date NOT NULL, source_mode text NOT NULL, saved_payment_method_id uuid,
  status text NOT NULL DEFAULT 'active', completed_at timestamptz, spent_at timestamptz, applied_order_id uuid, break_fee_percent numeric(12,2) NOT NULL DEFAULT 0,
  terms_accepted_at timestamptz, non_withdrawable_accepted_at timestamptz, auto_debit_authorized_at timestamptz,
  early_end_fee_accepted_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_savings_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), goal_id uuid NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  order_id uuid NOT NULL, amount numeric(12,2) NOT NULL, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, UNIQUE (order_id), UNIQUE (merchant_id, idempotency_key)
);
CREATE TABLE public.customer_savings_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), goal_id uuid NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  event_type text NOT NULL, actor_type text NOT NULL, actor_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
SQL

for migration in \
  20260521131000_customer_device_savings_rpcs.sql \
  20260521205531_customer_savings_order_redemptions.sql \
  20260607211250_fix_savings_goal_zero_initial_allocation.sql \
  20260608063606_fix_savings_goal_autodebit_wallet_balance.sql \
  20260611120000_swap_customer_savings_goal_device.sql \
  20260911204500_require_savings_goal_variant_when_product_has_variants.sql \
  20260911210000_harden_savings_goal_exact_variant_selection.sql \
  20260911210100_require_exact_savings_redemption_variant.sql \
  20260911211000_close_savings_variant_and_redemption_gaps.sql \
  20260911211100_require_finite_customer_savings_money.sql \
  20260911211200_require_finite_savings_order_total.sql
do
  "${psql[@]}" -f "$worktree/supabase/migrations/$migration" >/dev/null
done

for test_file in \
  customer_savings_exact_variant_safeguards.sql \
  customer_savings_recovery_auth_regressions.sql \
  customer_savings_variant_economics_regressions.sql \
  customer_savings_finite_money_regressions.sql
do
  "${psql[@]}" -f "$worktree/supabase/migrations/tests/$test_file"
done

printf 'Synthetic customer-savings SQL regressions passed.\n'
