-- Ledger of verified PiggyVest interest payouts.
--
-- One row per provider payout, deduped on the provider's own payout identity
-- (`eventData.id` from interest-payout.success). The inbox collapses
-- redeliveries on event_id; this table collapses them on payout identity, so
-- a duplicate can never double-credit even across distinct deliveries.
--
-- Invariant enforced at write time (processor slice): gross_kobo -
-- withholding_tax_kobo = net_kobo = amount_kobo. Only the reconciled net
-- counts toward purchasing power; pending accrual is never spendable and is
-- never stored here.

CREATE TABLE IF NOT EXISTS "public"."piggyvest_interest_payouts" (
  "provider_payout_id" "text" PRIMARY KEY,
  "event_id" "text" NOT NULL,
  "customer_id" "text" NOT NULL,
  "wallet_id" "text" NOT NULL,
  "amount_kobo" bigint NOT NULL CHECK ("amount_kobo" >= 0),
  "gross_kobo" bigint NOT NULL CHECK ("gross_kobo" >= 0),
  "withholding_tax_kobo" bigint NOT NULL CHECK ("withholding_tax_kobo" >= 0),
  "net_kobo" bigint NOT NULL CHECK ("net_kobo" >= 0),
  "reference" "text" NOT NULL,
  "batch_id" "text" NOT NULL,
  "paid_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  CONSTRAINT "piggyvest_interest_payouts_net_check"
    CHECK ("gross_kobo" - "withholding_tax_kobo" = "net_kobo"),
  CONSTRAINT "piggyvest_interest_payouts_amount_check"
    CHECK ("amount_kobo" = "net_kobo")
);

CREATE INDEX IF NOT EXISTS "piggyvest_interest_payouts_wallet_idx"
  ON "public"."piggyvest_interest_payouts" ("wallet_id");

-- Service-role only: the webhook processor uses the admin client. Enabling
-- RLS with no policy denies all anon/authenticated access by default.
ALTER TABLE "public"."piggyvest_interest_payouts" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."piggyvest_interest_payouts" IS
  'Verified PiggyVest interest payouts. Net only; duplicates collapse on provider payout id.';
