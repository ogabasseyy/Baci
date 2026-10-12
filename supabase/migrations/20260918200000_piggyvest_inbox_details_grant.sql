-- Additive grant for the inbox replay column (18 Sep 2026).
--
-- 20260918190000 added `event_details`, but the lease migration's
-- column-level INSERT grant predates it, so the service role cannot
-- persist redacted replay details. Grants accumulate, so this narrowly
-- extends INSERT to the new column. No other privilege changes.

GRANT INSERT (event_details)
  ON TABLE public.piggyvest_webhook_inbox TO service_role;
