-- Durable inbox for PiggyVest webhooks (Task 3 of the savings plan).
--
-- The provider may redeliver events; `event_id` is the dedupe key (scope
-- still unconfirmed provider-side, so treat it as globally unique and never
-- as an ordering signal). Only validated envelope fields are persisted —
-- there is deliberately NO raw-payload column: bank account numbers and
-- names appear in inflow payloads and must never be stored verbatim.
--
-- Worker protocol: INSERT ... ON CONFLICT DO NOTHING (duplicates collapse),
-- then atomically claim one pending row per worker transaction before any
-- ledger mutation. Financial processing must join this inbox state so a
-- redelivered event can never double-credit.

CREATE TABLE IF NOT EXISTS "public"."piggyvest_webhook_inbox" (
  "event_id" "text" PRIMARY KEY,
  "event_type" "text" NOT NULL,
  "event_category" "text" NOT NULL,
  "customer_id" "text" NOT NULL,
  "wallet_id" "text" NULL,
  "reference" "text" NULL,
  "amount_kobo" bigint NULL,
  "status" "text" NOT NULL DEFAULT 'pending'
    CONSTRAINT "piggyvest_webhook_inbox_status_check"
    CHECK ("status" IN ('pending', 'processing', 'processed', 'failed')),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" "text" NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  "processed_at" timestamp with time zone NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT "now"()
);

CREATE INDEX IF NOT EXISTS "piggyvest_webhook_inbox_pending_idx"
  ON "public"."piggyvest_webhook_inbox" ("status", "received_at")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "piggyvest_webhook_inbox_customer_idx"
  ON "public"."piggyvest_webhook_inbox" ("customer_id", "received_at");

-- Service-role only: the webhook handler uses the admin client. Enabling RLS
-- with no policy denies all anon/authenticated access by default.
ALTER TABLE "public"."piggyvest_webhook_inbox" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."piggyvest_webhook_inbox" IS
  'Dedupe + processing ledger for PiggyVest webhooks. No raw payloads stored.';
