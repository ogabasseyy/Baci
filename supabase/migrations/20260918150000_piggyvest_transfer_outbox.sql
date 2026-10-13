-- Outbox of our own PiggyVest transfer submissions (refunds, withdrawals,
-- merchant payouts), keyed by OUR reference — the idempotency key we send
-- with every transfer and get back on webhooks and TSQ.
--
-- Lifecycle: a submission inserts 'submitted'; the first terminal webhook
-- (outflow success/failed) flips it to 'succeeded'/'failed'. The flip wins
-- atomically only from 'submitted', so a conflicting late arrival (success
-- then failed, or vice versa) can never overwrite the first terminal state.
-- Reconciliation always joins this table: money moves only on positive
-- attribution of a webhook to a reference we actually submitted.
--
-- Destination is stored as a wallet id or as bank code + last4 only — full
-- destination account numbers are never persisted (PII minimization).

CREATE TABLE IF NOT EXISTS "public"."piggyvest_transfer_outbox" (
  "reference" "text" PRIMARY KEY,
  "customer_id" "uuid" NOT NULL,
  "merchant_id" "uuid" NOT NULL,
  "wallet_id" "text" NOT NULL,
  "amount_kobo" bigint NOT NULL CHECK ("amount_kobo" > 0),
  "direction" "text" NOT NULL
    CONSTRAINT "piggyvest_transfer_outbox_direction_check"
    CHECK ("direction" IN ('wallet', 'bank')),
  "destination_ref" "text" NOT NULL,
  "status" "text" NOT NULL DEFAULT 'submitted'
    CONSTRAINT "piggyvest_transfer_outbox_status_check"
    CHECK ("status" IN ('submitted', 'succeeded', 'failed')),
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT "now"()
);

CREATE INDEX IF NOT EXISTS "piggyvest_transfer_outbox_wallet_idx"
  ON "public"."piggyvest_transfer_outbox" ("wallet_id");

-- Service-role only: submission and webhook flows use the admin client.
-- Enabling RLS with no policy denies all anon/authenticated access.
ALTER TABLE "public"."piggyvest_transfer_outbox" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."piggyvest_transfer_outbox" IS
  'Our PiggyVest transfer submissions keyed by our reference. First terminal webhook wins; destinations stored masked.';
