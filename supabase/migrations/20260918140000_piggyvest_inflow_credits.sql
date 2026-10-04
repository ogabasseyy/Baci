-- Ledger of verified PiggyVest bank-transfer inflows.
--
-- One row per provider transaction, deduped on the provider's own
-- transaction identity (`eventData.transaction_id` from
-- bank-transfer.inflow.success). The inbox collapses redeliveries on
-- event_id; this table collapses them on transaction identity, so a
-- duplicate can never double-credit even across distinct deliveries.
--
-- A credited inflow records that the provider confirmed funds, not that our
-- ledger balance moved: wallet balances remain live provider reads. Amount
-- must be positive (a zero-amount inflow is poison, rejected here and in
-- app code). Sender identity columns are deliberately absent: bank account
-- numbers and names appear in inflow payloads and must never be stored
-- verbatim (PII minimization).

CREATE TABLE IF NOT EXISTS "public"."piggyvest_inflow_credits" (
  "provider_transaction_id" "text" PRIMARY KEY,
  "event_data_id" "text" NOT NULL,
  "event_id" "text" NOT NULL,
  "customer_id" "text" NOT NULL,
  "wallet_id" "text" NOT NULL,
  "amount_kobo" bigint NOT NULL CHECK ("amount_kobo" > 0),
  "fee_kobo" bigint NOT NULL CHECK ("fee_kobo" >= 0),
  "reference" "text" NOT NULL,
  "session_id" "text" NOT NULL,
  "credited_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"()
);

CREATE INDEX IF NOT EXISTS "piggyvest_inflow_credits_wallet_idx"
  ON "public"."piggyvest_inflow_credits" ("wallet_id");

-- Service-role only: the webhook processor uses the admin client. Enabling
-- RLS with no policy denies all anon/authenticated access by default.
ALTER TABLE "public"."piggyvest_inflow_credits" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."piggyvest_inflow_credits" IS
  'Verified PiggyVest bank-transfer inflows. Duplicates collapse on provider transaction id; no sender PII stored.';
