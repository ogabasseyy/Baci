-- Baci customer/merchant -> PiggyVest plan-wallet mapping.
--
-- One row per (customer, merchant): the deterministic subaccount_name derives
-- from those ids so provider-side retries cannot mint duplicate wallets, and
-- the unique constraint collapses concurrent ensure-requests. Status mirrors
-- the provider lifecycle: 'provisioning' until retrieve reports active
-- ('ready'); restriction webhooks flip it to 'restricted' (processor slice).
-- No money is stored here — balances always come from live provider reads.

CREATE TABLE IF NOT EXISTS "public"."piggyvest_plan_wallets" (
  "id" "uuid" PRIMARY KEY DEFAULT "gen_random_uuid"(),
  "customer_id" "uuid" NOT NULL,
  "merchant_id" "uuid" NOT NULL,
  "piggyvest_customer_id" "text" NOT NULL,
  "wallet_id" "text" NOT NULL,
  "subaccount_name" "text" NOT NULL,
  "status" "text" NOT NULL DEFAULT 'provisioning'
    CONSTRAINT "piggyvest_plan_wallets_status_check"
    CHECK ("status" IN ('provisioning', 'ready', 'restricted')),
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  CONSTRAINT "piggyvest_plan_wallets_customer_merchant_key"
    UNIQUE ("customer_id", "merchant_id"),
  CONSTRAINT "piggyvest_plan_wallets_wallet_key" UNIQUE ("wallet_id")
);

-- No extra index on (customer_id, merchant_id): the unique constraint
-- already indexes that pair; a second index would only tax writes.
-- Service-role only: routes use the admin client. Enabling RLS with no
-- policy denies all anon/authenticated access by default.
ALTER TABLE "public"."piggyvest_plan_wallets" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."piggyvest_plan_wallets" IS
  'Baci customer/merchant to PiggyVest plan-wallet mapping. Balances are never stored here.';
